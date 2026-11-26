> Historical record: demo Mock/Custom providers and their integration scripts were removed. Use README.md for the current real-provider setup and offline test commands.

# Hiveflow — Node Picker & New Nodes Plan (Phases 6–11)

Continuation of `SPACES_PLAN.md` (Phases 0–5 are done: canvas, persistence, single-node runs, edge data flow, run-all, cache, stale, cancel). Read `SPACES_PLAN.md` §1 (working agreements), `docs/DECISIONS.md` and the current code before starting. The same working agreements apply: **one phase at a time**, run acceptance checks, commit, stop and summarize. Record every assumption in `docs/DECISIONS.md`.

## 0. Goal

1. A Magnific-style **node picker**: searchable, category chips, keyboard-driven (`N` opens, `↑/↓` navigate, `Enter` inserts).
2. Three new nodes next to the existing Image Generator / Text / Image Upload:
   - **Assistant** (text in → text out, LLM)
   - **Voiceover** (text in → audio out, TTS)
   - **Video Generator** (text + optional start/end image in → video out)
3. All new nodes work end-to-end with **mock providers first** (no API keys needed), then real providers are added last behind a cost guard.

Out of scope: Image Upscaler, Image Editor, Variations, 3D, List, Designer, Modify video; user upload of audio/video; auth/billing; multi-replica scaling.

## 1. What is hard-coded today and must be generalized (found in the current code)

Adding a node type currently means touching all of these. Phase 7 removes that.

| Where                                 | Hard-coded assumption                                                                                                                                                                                                                        |
| ------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/shared/src/types.ts`        | `PortType = 'text' \| 'image'`; `NodeType` is a literal union                                                                                                                                                                                |
| `packages/shared/src/runs.ts`         | `nodeRunSchema.nodeType` enum, `assetSchema.kind: 'image'`, `runOutputSchema = { text?, image? (max 4) }`, `executionHash(prompt, references)`                                                                                               |
| `assets` table (migration)            | `CHECK (kind = 'image')`, `width/height NOT NULL`, `size_bytes integer`                                                                                                                                                                      |
| `AssetsService`                       | everything is normalized to PNG with `sharp`; storage key `.png`; `Content-Disposition` `.png`                                                                                                                                               |
| `GET /assets/:id`                     | streams the whole object, no `Range` support, `Cache-Control: private, no-store`                                                                                                                                                             |
| `ResolvedInputs` / `InputResolver`    | `{ prompt?, references[] }`; branches on `source.type === 'text'` / `'image_upload'`                                                                                                                                                         |
| Providers                             | one `IMAGE_PROVIDER` injection token; `generate()` returns `Buffer`s                                                                                                                                                                         |
| `model` param                         | free-form string; `'auto'` is hashed literally (once the default model changes, a cached result from the old model is served), no availability concept (models whose provider has no key are selectable), no per-model capability validation |
| Config / queue                        | one `PROVIDER_TIMEOUT_MS` (120 s default), one worker queue, `RUN_RECOVERY_TIMEOUT_MS` just above it                                                                                                                                         |
| `apps/web/src/canvas/SpaceCanvas.tsx` | the add-node menu is a hard-coded list; `N` shortcut does not exist                                                                                                                                                                          |

## 2. Phase order and why

| #   | Phase                       | Why here                                                                                                              |
| --- | --------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| 6   | Node picker UI              | Frontend only, visible win, no backend risk. Registry-driven, so new nodes appear automatically later.                |
| 7   | Generalize platform         | Refactor with **no behavior change**. Do it before adding nodes, otherwise every node copies the hard-coded branches. |
| 8   | Assistant node              | Smallest new node (text → text); proves the generalized resolver and provider registry.                               |
| 9   | Voiceover node              | Introduces the `audio` port and non-image assets.                                                                     |
| 10  | Video Generator node        | Hardest: long-running tasks, big files, `video` port. Needs everything above.                                         |
| 11  | Cost guard + real providers | Real providers cost money. The guard lands **before** any real adapter.                                               |

---

## Phase 6 — Node picker UI (frontend only)

Replace the hard-coded add menu in `SpaceCanvas.tsx` with a `NodePicker` component (`apps/web/src/canvas/NodePicker/`). Keep Hiveflow's existing dark theme and accent colour; copy Magnific's **behavior and layout**, not its light theme.

**Catalog**

- `apps/web/src/nodes/catalog.ts`: one entry per node type: `{ type, label, category, description, keywords[], icon, isNew? }`. Icons live in the web app; `category` and `description` also exist on the shared `nodeRegistry` entries (add them there; see Phase 7) so the catalog derives from the registry and cannot drift.
- Categories: `Image`, `Video`, `Audio`, `Text`, `Utilities`. Chips show only categories that have at least one node. Today that is Image, Text. Do **not** add placeholder or "coming soon" entries.

**Layout (top to bottom)**

1. Search field with a magnifier icon, auto-focused on open
2. Chip row: `All` + categories (horizontally scrollable if it overflows)
3. Section label `NODES`
4. List rows: tinted icon tile, node name, category as the subtitle, optional `New` pill
5. Footer hints: `N Open`, `↑↓ Navigate`, `⏎ Insert`

**Behavior**

- Opens from the `+` button or the `N` key. `N` is ignored inside text fields, textareas, and with Ctrl/Cmd/Alt held. `Esc` closes. Focus returns to the `+` button on close.
- Typing filters live, case- and diacritic-insensitive. Ranking: label prefix > label substring > keyword > category. Chip and search combine.
- `↑/↓` move the active row (wrap around), `Enter` inserts the active row, hover sets the active row, click inserts. Empty state: `No nodes match "xyz"`.
- Insert at the viewport centre in flow coordinates, reusing the existing offset logic so repeated inserts don't stack exactly. One insertion = **one undo step**.
- Accessibility: combobox + listbox pattern (`role="combobox"`, `aria-activedescendant`, `role="listbox"`/`option`), focus trapped while open, accessible names kept stable (the Playwright test depends on them).
- Pure ranking function `rankNodes(catalog, query, category)` in its own module with unit tests.

**Stretch (separate commit, do last in this phase)**: dragging an edge from a handle and releasing on empty canvas opens the picker filtered to nodes that have a **compatible port**; the chosen node is inserted at the drop point and auto-connected to its first compatible port (`onConnectEnd`). Must go through the shared `validateConnection`, and insert + connect is one undo step (same pattern as the existing attach-reference button).

**Acceptance**

- Press `N` → picker opens with search focused → type `tex` → `Enter` inserts a Text node → `Ctrl+Z` removes it.
- Unit tests for `rankNodes`; a Playwright test covers the keyboard flow.
- The old menu markup and CSS are deleted.

---

## Phase 7 — Generalize the platform (no behavior change)

Goal: after this phase, adding a node type is **one registry entry + one executor + one UI component**, with no edits to resolver, hash, schemas, or run-output code.

**7.1 Shared types and registry** (`packages/shared`)

- `PortType = 'text' | 'image' | 'video' | 'audio'`.
- `NodeType = keyof typeof nodeRegistry` (derived, not a hand-written union). `nodeRunSchema.nodeType` uses the registry keys.
- `NodeDef` gains: `category`, `description`, `keywords`, and an optional `staticOutput(params): RunOutput | null` for nodes whose output is a pure function of their params (Text, Image Upload). Nodes without it take the latest succeeded run output.
- Convention, enforced by a registry test: **an output port's `id` equals its `type`** (`text`, `image`, `video`, `audio`). This lets `RunOutput` be keyed by port type.
- `RunOutput = { text?: string; image?: AssetRef[] (max 4); video?: AssetRef[] (max 1); audio?: AssetRef[] (max 1) }`.
- Port colors: keep the existing text/image colors; add distinct video and audio colors. Don't rely on color alone (ports keep labels and tooltips).

**7.2 Asset model**

- Migration: drop the `kind = 'image'` check and allow `image | video | audio`; make `width`/`height` nullable; add `duration_ms integer NULL`; change `size_bytes` to `bigint`.
- `assetSchema` becomes a discriminated union on `kind` (image/video require width+height; audio and video carry optional `durationMs`).
- `AssetsService.store(spaceId, input)` takes `{ kind, bytes | stream, mime, meta }`. The image path keeps the existing `sharp` normalization. Audio/video path: mime allowlist (`audio/mpeg`, `audio/wav`, `audio/mp4`, `video/mp4`, `video/webm`), size cap by env (`MAX_AUDIO_MB`, `MAX_VIDEO_MB`), and **magic-byte sniffing** (MP4 `ftyp`, WAV `RIFF…WAVE`, MP3 `ID3`/frame sync, WebM EBML header), same spoof-protection standard as images. Storage key extension derives from the mime. `Content-Disposition` uses the right extension.
- `POST /assets` (user upload) stays **image-only**.

**7.3 Input resolution and hashing**

- `ResolvedInputs = { ports: Record<portId, ResolvedValue[]>; error?: string }` with `ResolvedValue = { kind: 'text'; value: string } | { kind: 'asset'; assetId: string; sha256: string; mediaKind: 'image' | 'video' | 'audio' }`. Values within a port keep edge order, then output order.
- `InputResolver` walks the registry's input ports; for each edge it takes `source.def.staticOutput(params)` if defined, otherwise the latest succeeded run output (or the batch output map during run-all). **No `source.type === '…'` branches.** Missing upstream output keeps the current user-facing messages (name + what to do).
- `executionHash(type, params, resolved)` hashes canonical params plus **all** resolved ports sorted by port id (text values, asset sha256 values; never asset IDs or signed URLs). It stays in `packages/shared` and is used by both API and FE stale detection.
- The `model` inside `params` that gets hashed is always the **resolved** model id, never the literal `auto` (see 7.4).
- Hashes change versus Phase 5, so old cache entries miss once. That is acceptable; record it in `DECISIONS.md`. Add fixed test vectors so future changes to the hash are deliberate.
- Update `ImageGeneratorExecutor` to read `inputs.ports.prompt` / `inputs.ports.references`. Behavior must be identical.

**7.4 Model catalog, availability and resolution** (the user picks a provider's model in every generating node)

- The catalog (`packages/shared/src/models.ts`) is the single source of truth for what _can_ be selected. Entry: `{ id, kind: 'image' | 'llm' | 'tts' | 'video', provider, providerModelId, label, status: 'active' | 'deprecated' | 'removed', aliases?, capabilities, options, costUnits }`.
  - `id` is Hiveflow's own **model-centric, stable id** (for example `kling-v2-1`, `seedance-2-0`, `gpt-image-1`), deliberately **not prefixed by the provider**. `provider` is a separate field and `providerModelId` is the string sent to the provider API. Saved graphs store only `id`, so a provider renaming a model never breaks them; renames are absorbed by `aliases`. If a second provider later serves the same model, the entry gains a provider list with a routing priority and the id stays the same, so saved graphs and cache keys are unaffected.
  - `capabilities` drive validation and UI. Video: `durations`, `aspectRatios`, `resolutions`, `supportsEndImage`, `supportsAudio`. Image: `aspectRatios`, `resolutions`, `maxCount`, `maxReferences`. LLM: `supportsImageInput`. TTS: `voices`, `languages`, speed range.
  - `options`: model-specific extra knobs as a small descriptor list `{ key, label, type: 'select' | 'number' | 'boolean', choices?, min?, max?, default }` (for example a quality mode or a seed). Stored in `params.options`, validated against the **selected model's** descriptors at run time, rendered generically in a collapsible "Advanced" section of the node. Keep the descriptor set this small in v1.
- **Availability is a runtime fact, not a static one.** `GET /models?kind=` returns catalog entries plus `{ available, unavailableReason?, isDefault }`; `available` means the provider is configured (credentials present) and `status !== 'removed'`. Every model select is fed from this endpoint (TanStack Query), grouped under provider headings with `Auto` first. **Selection is model-first:** the user chooses a model; the provider is shown only as a label and is never a separate dropdown. The provider stays a backend/operational concern (credentials, concurrency, retries, cost) and is recorded on the run in `node_runs.provider`. The hash uses the resolved model, not the provider. Unavailable models are shown **disabled with the reason** (for example "API key not configured"); they are neither hidden silently nor selectable.
- **`auto` is resolved when a run is created, and the _resolved_ model is what gets hashed.** Otherwise a cached result from model A is served after the default becomes model B.
  - `RunsService.start` and `prepareBatchRun` resolve `auto` to a concrete `id` using `DEFAULT_<KIND>_MODEL` (or the first available model of that kind), store it on the run (`node_runs.model`, new column, also shown in the node as "Generated with …"), and pass the resolved id into `executionHash`.
  - FE stale detection resolves `auto` with the `isDefault` flag from `GET /models`, so it computes the same hash as the server. Cover this with shared fixed-vector tests.
  - After a default change (env change plus restart), nodes that use `auto` correctly show as stale.
- **Switching model coerces dependent params in the same undo step.** When `model` changes, re-validate each capability-bound param (aspect ratio, resolution, duration, count, voice, language, speed): keep it if supported, otherwise snap to the nearest supported value or the model default, reset `options` to the new model's defaults, and show a short inline notice ("Duration changed to 5 s: not supported by this model"). Implement as a pure `coerceParamsForModel(type, params, model)` in shared, with unit tests.
- **Validation split.** Graph **save** validation stays model-agnostic: any string `model` and the superset enums are accepted, so saving never fails because a provider is offline or a model was retired. **Run-time** validation checks the resolved model (exists, `status`, `available`) and every param against its capabilities and options, and fails fast with a readable message before any provider call. A saved graph that references a `removed` or unknown model shows a warning badge on the node and a "choose another model" error on Run; it never crashes the canvas.
- Retrofit the **existing Image Generator** node in this phase: its model select reads `GET /models?kind=image` like the new nodes, and `imageGeneratorParamsSchema` keeps `model` as a plain string plus the superset enums (see the validation split above).
- `ProviderRegistry`: `register(kind, providerCode, provider)` and `forModel(modelId)` (catalog entry first, then the provider implementation by its `provider` code). Keep `IMAGE_PROVIDER=mock` working as an alias. Replace the single `IMAGE_PROVIDER` token in executors with the registry. Mock models (`mock-image`, `mock-llm`, `mock-tts`, `mock-video`) are always registered and always available.
- The static catalog in code is intentional for the prototype (versioned together with the hash logic, easy to test). Shape each entry like a database model row (provider code plus capability flags) so moving it to a seeded table later, to add models without a deploy, is mechanical. Record this in `DECISIONS.md`.

**7.5 Provider errors, retries and per-provider limits**

- Providers throw a typed `ProviderError { code: 'rate_limited' | 'invalid_request' | 'content_blocked' | 'insufficient_quota' | 'unavailable' | 'timeout' | 'canceled'; retryable: boolean; userMessage: string; retryAfterMs?: number }`. The run's `error` stores `userMessage` (content-policy rejections and quota problems must be understandable, not raw provider payloads); raw details go to server logs with secrets redacted.
- Retry only `retryable` errors (`rate_limited`, `unavailable`, network), only **before a provider task has been accepted**, with exponential backoff and jitter, up to `PROVIDER_MAX_RETRIES` (default 2), honoring `retryAfterMs`. Never retry once a task id exists, because that risks a duplicate paid task.
- Concurrency is limited **per provider**, in addition to per space and per kind: `PROVIDER_CONCURRENCY_<CODE>` (default 2). A burst on one provider must not use the slots another provider needs. Implement with the same Postgres-advisory-lock pattern as the existing per-space limit; capacity-blocked jobs stay queued and are re-enqueued by reconciliation.

**Acceptance**

- All existing unit, integration, smoke and Playwright tests pass unchanged except fixtures that embed old hashes.
- A test registers a **fake node type** in a cloned registry and proves validation, resolution, hashing and stale calculation work without touching any resolver or schema code.
- `grep -rn "'image_generator'" apps packages` finds it only in the registry, its executor, its UI component, and tests.
- Changing `DEFAULT_IMAGE_MODEL` makes the same `auto` node produce a different hash (no cache hit) and the FE shows it as stale.
- `GET /models` lists mock models as available and a provider without credentials as unavailable, with the reason.
- `coerceParamsForModel` unit tests: unsupported duration, aspect ratio, voice; `options` reset on model change.
- A run whose saved model is `removed` or unknown fails fast with the "choose another model" message and makes no provider call.
- Provider error tests: a retryable error retries with backoff; a non-retryable one fails at once; nothing is retried after a task id exists.

---

## Phase 8 — Assistant node (text → text)

**Node `assistant`** (category `Text`)

- Inputs: `context` (text, `multiple`, optional), `images` (image, `multiple`, optional, for vision models).
- Output: `text`.
- Params: `message: string` (≤ 8,000 chars), `preset: 'free' | 'prompt_improver' | 'image_to_prompt' | 'script_writer'`, `model: 'auto' | string`.
- Presets are system prompts kept in `packages/shared/src/assistant-presets.ts` with an exported `ASSISTANT_PRESETS_VERSION`; the version is part of the hash so editing preset text correctly invalidates caches. Bump it whenever preset text changes.
- If `images` are connected and the chosen model lacks `supportsImageInput`, fail with a clear message before calling the provider.

**API**

- `LlmProvider.complete({ system, messages: [{ role, text, images?: {url}[] }], model, maxTokens }, signal) → { text, usage? }`.
- `AssistantExecutor`: builds the system prompt from the preset; user message = connected `context` texts (edge order) + local `message`. Total context cap 20,000 chars (reject with a clear error, do not silently truncate). Output stored in `node_runs.output.text`, capped at 20,000 chars.
- `MockLlmProvider`: deterministic, preset-aware fake text (for example an "improved prompt" that visibly echoes the input), with a short delay. Honors `MOCK_FAILURE_RATE`.
- No streaming in v1 (record in `DECISIONS.md`; SSE already exists, so a `run.delta` event can be added later).
- Caching note: LLM output is not deterministic, but the same hash returns the previous result. This is intended; **Force rerun** regenerates. Document it.

**UI**

- Card: message textarea, preset select, model select (from `GET /models?kind=llm`: grouped by provider, `Auto` first, unavailable models disabled with the reason), Run button, result area (scrollable, read-only, **Copy** button). Two input handles (context, images) and one text output.
- Register in the catalog: category Text, `isNew: true`.

**Acceptance**

- Text → Assistant (`prompt_improver`) → Image Generator works with Run all, cache hit, stale propagation and cancel.
- Connecting images to a model without vision support shows the clear error.
- Picker finds it by typing `assist`.

---

## Phase 9 — Voiceover node (text → audio)

**Node `voiceover`** (category `Audio`)

- Input: `script` (text, optional; falls back to the local script).
- Output: `audio`.
- Params: `script: string` (≤ 5,000 chars), `model: 'auto' | string`, `voice: string` (from the model's `voices`), `language: 'auto' | string`, `speed: number` (0.75–1.5, step 0.05).

**API**

- `TtsProvider.synthesize({ text, voice, language, speed, model }, signal) → { bytes, mime, durationMs }`.
- `VoiceoverExecutor` stores the result with kind `audio`, `durationMs`, correct mime.
- `MockTtsProvider`: generates a valid **16-bit PCM mono WAV in pure Node (no new dependency)**; duration ≈ `wordCount / 2.5 / speed` seconds, capped at 5 minutes; a soft deterministic tone pattern derived from the text hash so different scripts sound different. Mock voices listed in the catalog.

**UI**

- Card: script textarea (disabled with a badge when a Text/Assistant node is connected, same pattern as the generator prompt), voice select, language select, speed slider, `<audio controls>` player, duration label, Run.
- Voices and languages come from the **selected model**; changing the model re-coerces them (7.4). Model select works as in Phase 8 (`GET /models?kind=tts`).
- Port color for `audio`; compatible with `Assistant → Voiceover` and `Text → Voiceover`.

**Acceptance**

- Assistant (`script_writer`) → Voiceover plays audio in the node; Run all, cache, stale, cancel behave like other nodes.
- Asset passes magic-byte sniffing and downloads with the right content type.

---

## Phase 10 — Video Generator node (long-running)

**Node `video_generator`** (category `Video`)

- Inputs: `prompt` (text, optional), `start_image` (image, single, optional), `end_image` (image, single, optional).
- Output: `video` (one asset).
- Params: `prompt: string`, `model: 'auto' | string`, `duration: number` (seconds, options from model capabilities), `aspectRatio` (`16:9 | 9:16 | 1:1`), `resolution` (`720p | 1080p`), `generateAudio: boolean` (default false). Always one video per run (video is expensive).
- Capability checks at run time from the model catalog: end image on a model without `supportsEndImage`, an unsupported duration or aspect ratio, or `generateAudio` without `supportsAudio` fail with a clear message **before** calling the provider.

**Why this needs more than the image pattern** (root causes in the current code)

1. **Timeouts.** A single `PROVIDER_TIMEOUT_MS` (120 s default) and a recovery timeout just above it will mark any video taking more than about 2 minutes as failed/`worker_lost`. Add per-kind timeouts: `IMAGE_TIMEOUT_MS`, `LLM_TIMEOUT_MS`, `TTS_TIMEOUT_MS`, `VIDEO_TIMEOUT_MS` (default 15 min). `RUN_RECOVERY_TIMEOUT_MS` must stay above the largest; update the config validation ranges.
2. **Worker starvation.** One queue with `WORKER_CONCURRENCY=6` means six slow video jobs block every image/text/audio run. Use a **separate queue for video** with its own `VIDEO_WORKER_CONCURRENCY` (default 2). Per-provider limits from 7.5 still apply inside that queue, so a burst on one video provider cannot occupy the slots the other needs. (Delayed-job polling would scale better but is more complex; record the trade-off.)
3. **Restart safety.** Today a run found `running` after a crash is failed as `worker_lost`. For video that would waste a paid task. Persist `provider_task_id` (new nullable column on `node_runs`) as soon as the provider accepts the task; on recovery, a run that has a task id is **resumed by polling only, never re-submitted**.
4. **Large files.** `Buffer` results are fine for images, not for video. Use a streaming write to S3 (multipart via `@aws-sdk/lib-storage`), hashing sha256 while streaming, capped by `MAX_VIDEO_MB`.
5. **Playback.** Browsers need HTTP **Range** requests to seek video. Implement `Range` on `GET /assets/:id` (206, `Content-Range`, `Accept-Ranges: bytes`, using S3 ranged `GetObject`). Assets are immutable by ID, so media may use `Cache-Control: private, max-age=3600` instead of `no-store` (record the decision). Update `docker/web/default.conf` so `/api/assets/` passes `Range` and does not buffer large responses.

**Provider interface (task based)**

```ts
interface VideoProvider {
  id: string;
  submit(req: VideoRequest, signal: AbortSignal): Promise<{ taskId: string }>;
  poll(
    taskId: string,
    signal: AbortSignal,
  ): Promise<{
    status: 'queued' | 'running' | 'succeeded' | 'failed';
    progress?: number; // 0–100 if the provider reports it
    result?: {
      stream: Readable;
      mime: string;
      width?: number;
      height?: number;
      durationMs?: number;
    };
    error?: string;
  }>;
  cancel?(taskId: string): Promise<void>;
}
```

- Executor flow: validate capabilities → `submit` → checkpoint `provider_task_id` → poll with backoff (2 s growing to 10 s) until a terminal state, timeout, or abort → stream the result into storage → asset. Cancel calls `provider.cancel` when available, then aborts locally; late results never overwrite `canceled`.
- Progress: `run.updated` events gain an optional `progress`. Emit on change, but **persist only status transitions** (no DB write per poll).
- Mock provider: simulates a task over about 15–30 s with `queued → running (progress) → succeeded`, honors cancel and `MOCK_FAILURE_RATE`. It returns a tiny valid MP4 (< 300 KB, about 2 s, 320×180) from a **committed fixture** `apps/api/assets/mock-video.mp4`, generated once by `scripts/make-mock-video.mjs` (ffmpeg via `ffmpeg-static` as a devDependency; the runtime does not need ffmpeg). If the ffmpeg binary cannot run on this machine (native binaries may be blocked), say so in `DECISIONS.md` and ask the user to place any short MP4 at that path. This is the only case in which to stop and ask.

**UI**

- Card: prompt textarea (disabled with a badge when connected), model select, duration/aspect/resolution selects driven by the selected model's capabilities (options not supported by a model are disabled, not hidden), audio toggle shown only when supported, `<video controls preload="metadata" playsInline>`, progress bar with elapsed time while running, Run/Cancel.
- If an image is connected to `end_image` but the selected model has no `supportsEndImage`, show a warning badge on that port and block Run with the reason, instead of failing later at the provider.
- Model select as in Phase 8 (`GET /models?kind=video`, grouped by provider); changing the model re-coerces duration, aspect ratio, resolution and options (7.4).
- Handles: `prompt` (text), `start_image`, `end_image` (image), output `video`.

**Acceptance**

- Text → Assistant → Video Generator and Image Upload → `start_image` both run with the mock; video plays and **seeks** (Range works); progress bar moves.
- Kill and restart the API mid-run: the run resumes polling and finishes; it is not failed as `worker_lost` and the mock sees exactly one `submit`.
- Six concurrent video runs do not delay an image run (separate queues).
- Extend the Playwright smoke test: Text → Assistant → {Image Generator, Voiceover, Video Generator}, Run all, all four outputs visible, rerun hits cache, edit text → stale, cancel works.

---

## Phase 11 — Cost guard, then real providers

### 11.1 Cost guard (do this first)

Today one Run all on a large graph can queue many paid generations (graphs may have up to 1,000 nodes, and an image node up to 4 images). Rate limits only slow that down.

- Each catalog model has `costUnits` (abstract credits): image = per image × resolution factor; video = per second × resolution factor; TTS = per 1,000 characters; LLM = flat per call.
- `POST /spaces/:id/run/estimate` returns `{ providerNodes, cachedNodes, units }` using the same hash, cache lookup and `auto` resolution as a real run (cache hits cost 0; the resolved model's `costUnits` are used). Label units as **estimates** in the UI, because provider pricing changes.
- Run all and single-node run enforce: `MAX_BATCH_PROVIDER_NODES` and `MAX_BATCH_UNITS` (env) → `422` with a clear message when exceeded.
- UI: **Run all** first calls estimate and shows a confirm step ("7 nodes, about 120 credits, 3 cached"). Each node's Run button tooltip shows its estimate.
- `usage_ledger` table (`id, user_id, run_id, units, created_at`): reserve units when a run is created, refund on failure/cancel, enforce `DAILY_UNITS_LIMIT` for the dev user. This is also the foundation for future billing.

### 11.2 Real adapters

Adapters live in `apps/api/src/providers/<kind>/<name>.provider.ts`, are selected through the model catalog's `provider` code, read secrets from env only, and never log keys.

- **Rewrite**: implement fresh adapters from official provider documentation. Never copy/import implementation from another project. Official documentation overrides provider reference notes; record differences and source URLs in `docs/DECISIONS.md`.
- **Order**: 11.2a shared media/HTTP/download/capability groundwork; 11.2b OpenRouter LLM/image/speech and discovery script, then stop for user-selected model IDs; 11.2c Seedance and 11.2d Kling later; optional Veo only on request.
- Contract tests per adapter using handwritten documented fixtures (no live calls in CI). A manual `scripts/live-check.mjs <provider>` that only runs when an explicit env flag is set.
- Add each real model to the catalog with its `providerModelId`, accurate `capabilities`, `options` and `costUnits`; the model selects pick them up automatically through `GET /models`, and a model becomes selectable only when its provider's credentials are configured.
- Each adapter maps its failures to `ProviderError` (7.5): rate limits and 5xx are `retryable`; content-policy blocks, invalid parameters and exhausted quota are not, with a clear `userMessage`.

**Acceptance**

- Estimate matches the real ledger charge for a mixed graph; exceeding a limit returns `422` and shows in the UI; refunds happen on cancel/failure.
- With a real key configured, each real adapter completes one run in the manual live check (user-run).

---

## Cross-cutting rules

- Never commit keys. Add every new env var to `.env.example` with a safe default and to config validation.
- Every new node must: be in the registry, have a mock path, support Run, Run all, cache, stale and cancel, appear in the picker, and have at least one unit test of its executor.
- Keep `docs/DECISIONS.md` current; keep `README.md` accurate (node list, env vars, how to switch providers).

## Definition of done (Phases 6–11)

- Picker works with keyboard and mouse; Assistant, Voiceover and Video Generator run end-to-end on mocks and chain with each other.
- Platform has no per-node-type branches in resolver, hash, schemas or asset code.
- Video survives an API restart mid-run and plays with seeking.
- Cost guard blocks over-limit batches before any real provider is enabled.
- CI green: unit, integration smoke scripts, Playwright.
