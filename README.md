# Hiveflow

Hiveflow is a node-based image workflow prototype. **Phase 2 (persistence)** is implemented: saved Spaces, a React Flow canvas with three node types, autosave, and optimistic concurrency so competing tabs cannot silently overwrite each other.

## Run everything in Docker

Requires Docker Desktop (Linux containers) with Compose v2. Start Docker Desktop first. Node/npm are installed inside the build containers.

```powershell
if (!(Test-Path .env)) { Copy-Item .env.example .env }
docker compose up -d --build
```

Open <http://localhost:5173>. The API health endpoint is <http://localhost:3000/health> and returns `{"status":"ok","app":"Hiveflow"}` once PostgreSQL connects. MinIO's local console is at <http://localhost:9001>; credentials are in `.env`. The `minio-init` service creates the private `hiveflow-assets` bucket and exits successfully.

After this first setup, use Docker Desktop → Containers → the **hiveflow** group → **Start/Stop** to run/stop the entire application, including FE and BE. Keep the containers when stopping: `docker compose stop` preserves them; `docker compose down` removes them and requires `up` to create them again.

The frontend is built with Vite and served by Nginx; the backend runs the compiled NestJS app. Nginx forwards `/health` and `/api/*` to the API container. After changing source code, run `docker compose up -d --build` to refresh the images. The API waits for Postgres/Redis health and successful bucket bootstrap, then applies TypeORM migrations before starting. Database synchronization stays disabled. Existing `.env` settings and named volumes are preserved when updating.

MinIO and its client build from pinned upstream Go source revisions because their Docker Hub images are unavailable. Docker handles the Go toolchain; you do not need Go installed locally. The first `docker compose up` can take several minutes. To rebuild explicitly, use `docker compose up --build -d`.

The bootstrap container `minio-init` should show `Exited (0)` after it creates the bucket. Use `docker compose up -d` without `--wait`: Compose can report a successful one-shot bootstrap exit as an error with that flag. To wait for the long-running services explicitly, run `docker compose up -d --wait postgres redis minio`.

If another PostgreSQL instance uses port 5432, set `POSTGRES_PORT=5433` in `.env` and change the port in `DATABASE_URL` to 5433 too. The container still uses port 5432 internally.

`WEB_PORT` and `API_PORT` control exposed host ports (defaults 5173/3000). Inside Docker, API/database/Redis/storage connections use Compose service names; the API always listens on container port 3000. The host `DATABASE_URL` is used only for the optional local development workflow.

## Optional local development with hot reload

Requires Node 20+ (Node 22 recommended) and npm 10+. Stop the Docker application containers first to free the frontend/backend ports:

```powershell
docker compose stop web api
docker compose up -d postgres redis minio minio-init
npm ci
npm run dev
```

`npm run dev` builds shared first, then runs shared's TypeScript watcher, Nest's watcher, and Vite concurrently. The API development command applies pending migrations before starting the watcher. Both apps import built output from `@hiveflow/shared`. Restart Vite if adding a new shared dependency changes dependency prebundling.

## Commands

```text
npm run build          Build shared, API, then web
npm run typecheck      Build shared and check all workspaces
npm run lint           ESLint dependency checks and Prettier
npm run format         Format source/configuration
npm test               Run shared, web, and API unit tests
npm run migration:run  Apply TypeORM migrations manually (build shared first)
node apps/api/scripts/smoke-spaces.mjs  Test CRUD/concurrency against a running API and DB
node apps/api/scripts/smoke-runs.mjs    Test uploads, runs, SSE and recovery with API/DB/Redis/MinIO
node apps/api/scripts/smoke-batches.mjs Test scheduling, cache, cancellation and concurrency
node apps/api/scripts/smoke-models.mjs  Test model availability, validation and run provenance
node apps/api/scripts/smoke-assistant.mjs Test Assistant dataflow, vision, cache and cancellation
node apps/api/scripts/smoke-voiceover.mjs Test Voiceover workflow, WAV delivery, cache and cancellation
node apps/api/scripts/smoke-video.mjs Test video tasks, streaming, Range, progress and queue isolation (build API first)
npm exec -w @hiveflow/web -- playwright install chromium  Install the E2E browser once
npm run test:e2e -w @hiveflow/web   Run the browser execution smoke check
docker compose up -d --build  Build and run the whole application
docker compose stop          Stop all containers, preserving them for Docker Desktop Start
docker compose start         Start existing containers
docker compose down          Remove containers, preserving named volumes
```

CI uses `npm ci`, then build, typecheck, lint, and unit tests. It prepares PostgreSQL, Redis and MinIO, applies migrations, runs all seven API integration scripts, and installs Chromium for the Playwright smoke test. Scripts use root `.env` (environment values take precedence) and `API_BASE_URL` (default `http://127.0.0.1:3000`); they create and clean up only their own fixtures. Run execution checks with `MOCK_FAILURE_RATE=0` and the default provider timeout. E2E uses `E2E_BASE_URL` (default `http://127.0.0.1:5173`), reuses a running Docker web app locally, or starts Vite against an already running API in CI. Its UI-created Space is removed afterward; object garbage collection follows the prototype's deferred cleanup policy.

## Saved Spaces

Open the home page to create, open, or delete a Space. Each Space has a permanent `/spaces/:id` URL. Rename it in the canvas header. Edits and viewport changes autosave after approximately 800 ms, with one request in flight at a time. The header shows Saved, Unsaved changes, Saving, Save failed, or Conflict.

If another tab saves first, your tab keeps its local edits and stops writing. Choose **Reload saved version** to discard the local edits, or **Save as copy** to preserve them in a new Space. A failed save has a **Retry save** control. **Spaces** in the header waits for pending saves before returning to the list. The browser also guards navigation while changes remain unsaved; browser settings and user activation determine how the native warning is displayed.

Graph writes validate node params, port compatibility, existing endpoints, duplicate IDs/edges, and cycles. Invalid input returns 400 with `errors: [{ path, message }]`. PATCH requires the current `version`; stale versions return 409. The prototype uses a fixed dev user while retaining ownership checks on every Space operation.

## Media Library

Open **Library** in the workspace sidebar (`/library`) to browse uploaded and generated images, videos and audio from your Spaces. Filter by media type or source Space; results are ordered newest first and paginated in groups of 24. Open a card to preview media, download the original stored file, or open its source Space. The existing search field on the Spaces page still searches Space names.

Library uses existing asset metadata and storage. `GET /api/assets` accepts optional `kind`, `spaceId`, `offset` and `limit` (1–100, default 24), and returns only assets belonging to the current user through their existing Spaces. Deleted Spaces and their media are excluded. `GET /api/assets/:id?download=1` serves an attachment with the same ownership and Range checks as inline playback. Direct Library uploads and cross-Space asset reuse are outside this version.

After building shared and API, `node apps/api/scripts/smoke-library.mjs` checks the real PostgreSQL query and an isolated HTTP controller. It creates and removes only its own fixtures, uses an in-memory download stream, and starts no workers or providers. `npm run test:e2e -w @hiveflow/web -- library.spec.ts` checks the Library UI with mocked API responses and local media fixtures.

## Using the canvas

- Click **+** in the left toolbar or press **N** to open the node picker. Search by name/keyword, filter by Image or Text, navigate with **↑/↓**, and press **Enter** to insert. Search ignores case and diacritics. **Esc** closes the picker and restores focus to **+**. Insertion uses the current viewport with an offset for repeated additions; **Ctrl/Cmd+Z** undoes one insertion. N is ignored while typing in text fields or holding Ctrl/Cmd/Alt. Each new Space starts with a Text node and an Image Generator.
- Drag from an input or output port onto empty canvas to open a picker containing only compatible node types. Choose a node to insert it at the drop point and connect its first valid port automatically. One Undo removes both the node and its edge. Escape dismisses this picker; opening with N/plus afterward restores the full catalog.
- Drag a node by its title or preview area. Drag from an output port to an input port of the same color: purple for text, green for images. Connections that duplicate a single input or create a cycle are refused.
- Choose **Select** (`V`) to move/select nodes, or **Hand** (`H`) to pan. Hold **Space** while dragging to pan temporarily. Scroll to zoom; use the lower-right controls for zoom and Fit view.
- **Delete/Backspace** removes selected nodes/edges. **Ctrl/Cmd+Z** and **Ctrl/Cmd+Shift+Z** undo/redo graph edits; viewport changes are excluded. Editing a textarea retains its native keyboard behavior.
- Drop/choose an image in Image Upload. The generator's **+** creates and connects a reference upload node. Uploads accept PNG, JPEG, WebP, AVIF and GIF, up to `MAX_UPLOAD_MB` and 16 megapixels. The API validates the decoded format, normalizes orientation and stores a metadata-free PNG in MinIO. Animated uploads use the first frame. Existing local-only references from earlier phases must be selected again.
- Type a prompt directly in Image Generator, or connect a Text output to its purple prompt input. Set count/ratio/resolution and click **Run**. It waits for uploads and autosave, queues one execution, and displays the mock PNGs after roughly 2–4 seconds plus image processing. Errors offer **Retry**. Running status and outputs survive refresh; SSE reconnects and history snapshots recover missed events.
- Graphs, names, node params, edges, viewport, uploaded images and generated results survive refresh. Only image metadata is stored in PostgreSQL; bytes live in MinIO. Save-as-copy duplicates uploaded references into the new Space. Execution history/results remain with the original Space.

Connected Text replaces the local generator prompt; the purple badge names its source and the prompt field shows the connected value read-only. Disconnect the purple edge to restore the preserved local prompt. Text is read directly from the saved graph without running a job. An empty connected Text fails clearly, even if a local prompt exists.

Connect Image Upload or Image Generator outputs to a generator's green references input. Uploads use their saved asset directly. Single-node runs use **all images from the source's latest succeeded run**, even if a newer run is queued, running or failed. Run upstream generators first when using individual Run controls, or choose **Run all** to schedule dependencies automatically. A connected source without usable output produces a named error and Retry. Disconnecting references removes those optional inputs; disconnecting prompt uses the local prompt, or gives a clear missing-prompt error if it is empty.

Single-node runs snapshot connected values when requested. Run all snapshots the entire graph and prepares each dependency level using successful outputs from that batch. Later graph edits affect the next request. The worker creates private S3 GET URLs valid for 15 minutes and passes them to the provider; signed URLs are never stored in graph/run JSON. The mock downloads and hashes references, so changing image content changes its deterministic preview.

## Running a workflow

- **Run all** waits for uploads/autosave, creates a durable batch, and runs topological levels in order. Nodes in a level run concurrently within the configured limits. The next level waits for every node in the previous level to finish. Failed or canceled nodes cause their descendants to be skipped; independent branches continue. The header displays batch progress and nodes waiting for dependencies display **Waiting for inputs…**.
- Successful results are cached by canonical node type/params and effective input text/image content hashes. Cache reuse is scoped to the same Space/node and checks asset metadata still exists. Rerunning unchanged work creates new **Cache hit** run records and reuses images without invoking the provider. Choose **Force rerun** beside Run all, or the node's Force rerun action, to bypass succeeded cache. Identical active single-node requests return the same run; only one active batch is allowed per Space.
- **Stale · inputs changed** means the current graph differs from the latest run. Changes also propagate through downstream image nodes before new images exist. Stale computation uses the same shared hash helper as the API, preserves reference order and ignores expiring URLs. Older events cannot replace newer node results or prepared inputs. Prior phase hashes may appear stale once after upgrading; rerun to refresh them.
- **Cancel run** stops one queued/running generator. In a batch, its dependents are skipped. **Cancel batch** cancels all unfinished nodes. Completed results remain available. Queued jobs are removed, running providers receive an abort signal, and conditional status updates discard late results. Refresh recovers batch progress and node state.
- Run creation shares a quota of **120 requests per minute per user** across single-node and batch endpoints. Rate-limited requests return 429; cancellation remains available. The prototype's fixed development user shares this quota across tabs.

## Configuration

Copy `.env.example` to root `.env`; the API and Compose read it. Never commit `.env`. After changing container environment settings, run `docker compose up -d` to recreate affected containers. Restart `npm run dev` when using the optional host workflow.

| Variable                                                                  | Purpose                                                                                     |
| ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| `API_PORT`, `WEB_ORIGIN`                                                  | API listen port and permitted browser origin                                                |
| `DATABASE_URL`                                                            | API PostgreSQL connection string                                                            |
| `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB`                       | Local Compose database initialization                                                       |
| `REDIS_URL`                                                               | BullMQ queue connection                                                                     |
| `MINIO_ROOT_USER`, `MINIO_ROOT_PASSWORD`                                  | Local MinIO administrator credentials                                                       |
| `S3_ENDPOINT`, `S3_REGION`, `S3_ACCESS_KEY`, `S3_SECRET_KEY`, `S3_BUCKET` | Object storage; keep credentials aligned with local MinIO                                   |
| `IMAGE_PROVIDER`, `MOCK_FAILURE_RATE`                                     | `mock` provider; injected failure probability 0–1                                           |
| `MAX_UPLOAD_MB`, `PROVIDER_TIMEOUT_MS`                                    | Upload MB limit (1–100, default 20) and executor timeout (default 120000 ms)                |
| `RUN_RECOVERY_TIMEOUT_MS`                                                 | Lost-worker cutoff; default provider timeout + 30000 ms, minimum provider timeout + 5000 ms |
| `WORKER_CONCURRENCY`                                                      | Fast queue worker parallelism (default 6; video has its own queue)                          |
| `SPACE_RUN_CONCURRENCY`                                                   | Maximum running nodes per Space (default 3); enforced when claiming queued work             |

The optional Vite development server proxies `/health` and `/api/*` to port 3000. If changing the host API port for that workflow, update `apps/web/vite.config.ts` too. Docker's Nginx proxy uses the fixed internal API port. No frontend secrets are exposed.

`IMAGE_PROVIDER=mock` generates deterministic gradient PNGs with the prompt printed on them, without an external AI account. To implement another provider, follow `apps/api/src/providers/custom-image.provider.example.ts`, implement `ImageProvider`, and register its factory in `RunsModule` before changing the environment value. Unknown provider names fail startup clearly. Keep credentials and vendor logic in the adapter. The configured S3 endpoint must be reachable by that provider: Compose's internal `minio` hostname works for the local mock; a remote provider requires externally reachable object storage or a dedicated signing endpoint in its adapter. To exercise Retry, set `MOCK_FAILURE_RATE=1`, recreate API, run a node, then restore `0`, recreate API and click Retry. Provider timeouts and lost workers also produce retryable errors.

## Layout and roadmap

- `apps/web`: frontend.
- `apps/api`: API and database configuration (`synchronize: false`).
- `packages/shared`: strict TypeScript types and schemas consumed by both apps.
- `docs/DECISIONS.md`: implementation assumptions.
- `SPACES_PLAN.md`: phase acceptance criteria and remaining prototype scope.
- `NODES_PLAN.md`: continuation for node picker, platform generalization and additional media nodes.

Phases 0–10, Phase 11.1 (cost guards) and Phase 11.2 (provider integrations, including the requested optional Veo step) are implemented. See `docs/PHASE_3_CHECKS.md` through `docs/PHASE_11_2_CHECKS.md` for verification evidence. The default provider remains a mock. Production work includes real authentication, shared event/rate-limit infrastructure for multiple API replicas and orphan-object cleanup.

## Models and platform (Phase 7)

Image Generator now loads its model menu from `GET /api/models?kind=image`. Auto uses the server default; concrete model IDs and provider codes are recorded on each run. Changing a default makes previous Auto results stale and prevents an obsolete cache hit. Older phase hashes miss once after this upgrade.

Models are grouped by provider. Unavailable/removed models stay visible with a reason. Saved graphs may retain unknown or retired model IDs; opening them shows a warning, and running asks you to choose another model. Switching models adjusts unsupported settings and resets Advanced options in one Undo step. Try **Mock Image Compact** to exercise quality, seed and soft-light options; all image generation remains local mock rendering. **Image Studio** is an illustrative custom-adapter entry without an implementation or credentials.

Additional configuration:

| Variable                                                                               | Default / purpose                                                    |
| -------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| `DEFAULT_IMAGE_MODEL`, `DEFAULT_LLM_MODEL`, `DEFAULT_TTS_MODEL`, `DEFAULT_VIDEO_MODEL` | `mock-image`, `mock-llm`, `mock-tts`, `mock-video`; aliases accepted |
| `PROVIDER_MAX_RETRIES`                                                                 | 2 retries for transient errors before a task is accepted             |
| `PROVIDER_CONCURRENCY_<CODE>`                                                          | 2 running jobs per provider across kinds; uppercase provider code    |
| `KIND_CONCURRENCY_IMAGE`, `KIND_CONCURRENCY_LLM`, `KIND_CONCURRENCY_TTS`               | 6 running jobs per kind                                              |
| `KIND_CONCURRENCY_VIDEO`                                                               | 2 running jobs                                                       |
| `MAX_AUDIO_MB`, `MAX_VIDEO_MB`                                                         | 25 / 250 MB for provider output storage                              |

Provider/kind limits add to existing Space/global limits. Capacity-blocked jobs remain queued. Retries honor Retry-After, cancellation and accepted-task guards. There are no external provider calls or new dependencies in this phase.

The platform understands text/image/audio/video ports and output metadata. Audio/video storage accepts bounded bytes or streams with MIME signature checks; user uploads remain image-only. Audio buffering is size-bounded; provider video is streamed through multipart S3 upload, with playback/Range and a separate video worker queue. Mock image, LLM, TTS and task-based video providers are executable through their generating nodes.

## Assistant (Phase 8)

Search **assist** in the picker to add Assistant under Text. Enter a message (up to 8,000 characters), choose Free form, Prompt improver, Image to prompt or Script writer, then Run. Connect multiple Text/Assistant outputs to its **context** input; their texts are joined in saved edge order, followed by the local message. The complete joined context must fit 20,000 characters; excess context is rejected without truncation. Empty instructions are allowed when images are connected.

Connect uploaded/generated images to **images** for vision models. Mock Assistant supports images; Mock Assistant Text deliberately does not, and running it with images gives a clear error before any provider request. The mock downloads signed references and echoes their content fingerprints; it does not perform visual analysis. Assistant Studio is an unavailable custom-adapter example. All generation remains local mock behavior without real AI credentials.

Results are read-only, selectable and scrollable, with a Copy button. Failed clipboard permission shows a manual-copy hint. Connect Assistant's purple **text** output to Image Generator's prompt and use **Run all** to execute Text → Assistant → Image Generator in dependency order. Cache hits, stale propagation, cancellation, refresh recovery and previous successful output retention work as for image nodes.

Assistant currently returns one completed response, with no token streaming. Stored output is capped at 20,000 characters. Preset system prompts live in `packages/shared/src/assistant-presets.ts`; bump `ASSISTANT_PRESETS_VERSION` whenever they change. That registry execution version participates in the same FE/API hash. Repeated inputs intentionally reuse the previous LLM result, even though a real LLM may be nondeterministic; use **Force rerun** to request a fresh completion. The mock remains deterministic after Force rerun. No new dependencies, environment variables or database migration are needed for Phase 8.

## Voiceover (Phase 9)

Search **voice** or choose **Audio → Voiceover** in the picker. Write a script (up to 5,000 characters), select the model, voice, language and speed, then Run. Speed uses steps of 0.05 from 0.75× to 1.50×, within the selected model's range. Voice/language choices come from that model's capabilities. Changing the model adjusts unsupported settings in one Undo step; **Mock Narrator** exercises this with a narrator voice, English and a narrower speed range.

Connect Text or Assistant's purple text output to **script**. The connected value overrides the preserved local script and disables local editing; disconnect to restore it. Empty or oversized connected scripts fail clearly rather than falling back or silently truncating. For a complete workflow, connect Text → Assistant (**Script writer**) → Voiceover and use Run all.

The completed audio appears in a native player with duration and Download audio. Cache, Force rerun, stale propagation, cancel and refresh recovery work as for other generating nodes. Audio metadata is stored in PostgreSQL; WAV bytes live in MinIO. Downloads carry `audio/wav` and a `.wav` filename.

**The mock creates soft tone patterns, not spoken narration.** It writes valid 16 kHz, mono, 16-bit PCM WAV directly in Node, without another package or external TTS account. Duration approximates word count ÷ 2.5 ÷ speed, with a minimum of 0.2 seconds and a maximum of five minutes. Tone patterns depend on script/voice/language/model so input changes are audible. Words are counted by whitespace; language selection is metadata for this mock, not pronunciation. Voice Studio is an unavailable custom-adapter example. Real speech providers remain Phase 11 behind cost guards; Video streaming and HTTP Range are implemented in Phase 10. No new environment variable, migration or dependency was added.

## Video Generator (Phase 10)

Choose Video → Video Generator in the picker. Enter a prompt or connect Text/Assistant output; the connected prompt overrides the preserved local prompt. Optional start/end image inputs accept Image Upload or Image Generator output. Duration, ratio, resolution and audio controls follow the selected model. Unsupported options remain visible but disabled. Changing models coerces dependent settings in one Undo step. A connected end image on an unsupported model displays a warning at the port and blocks Run until you disconnect it or choose another model.

Run all supports Text → Assistant → Image Generator / Voiceover / Video Generator. Video shows progress and elapsed time, supports Cancel, and plays/seeks in a native video player. Repeating unchanged work uses cache. Editing upstream text marks all affected outputs stale. Progress is volatile and emitted through existing SSE/history snapshots without a database write per poll.

**The mock returns a fixed 2-second, 320×180 silent MP4 test pattern**, irrespective of requested generation settings; it does not synthesize video. A task takes roughly 18–24 seconds plus polling/storage. Image references are actually downloaded and fingerprinted when submitted. The fixture is committed at `apps/api/assets/mock-video.mp4`; regenerate it with `node scripts/make-mock-video.mjs` (development-only ffmpeg-static). Docker/CI skip the generator binary download and runtime needs no ffmpeg.

Video uses its own BullMQ queue. Configuration additions:

| Variable                                               | Default / purpose                                                                          |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------ |
| `IMAGE_TIMEOUT_MS`, `LLM_TIMEOUT_MS`, `TTS_TIMEOUT_MS` | 120000 ms, falling back to legacy `PROVIDER_TIMEOUT_MS` when unset                         |
| `VIDEO_TIMEOUT_MS`                                     | 900000 ms (15 minutes)                                                                     |
| `RUN_RECOVERY_TIMEOUT_MS`                              | largest kind timeout + 30000; must exceed it by at least 5000 ms                           |
| `VIDEO_WORKER_CONCURRENCY`                             | 2, separate from the fast `WORKER_CONCURRENCY` queue                                       |
| `PROVIDER_CONCURRENCY_MOCK_VIDEO`                      | 2; mock video uses provider code `mock-video` to isolate its slots from mock image/LLM/TTS |

Upgrade old `.env` recovery values such as 150000 to at least 905000 with default video settings (example: 930000). Kind deadlines allow 1000–3600000 ms; recovery allows up to 7200000 ms. Local `.env` was raised to 930000 during this upgrade. Recreate API after environment changes.

Accepted video task IDs are checkpointed before polling. On API startup, unfinished video runs are requeued for polling with their existing task ID and original deadline. The mock persists its task state in PostgreSQL; stable per-run request IDs also make resubmission idempotent across the small acceptance/checkpoint crash window. Real adapters must honor that request ID as an idempotency key. No automatic resubmission occurs after a task ID is recorded. Cancel requests remote task cancellation where supported, then stops local work; conditional updates discard late results.

Video output streams directly into size-capped S3 multipart uploads with sha256 calculated as bytes flow. Failed uploads abort/clean their object; metadata stores no bytes or signed URLs. Audio/video IDs are immutable and served with private one-hour caching; image responses retain no-store. Single byte ranges support bounded, open-ended and suffix requests, returning 206 or 416; Nginx forwards ranges and disables buffering for asset downloads. Object/incomplete multipart cleanup after hard crashes remains production lifecycle work.

To repeat the local restart acceptance, run `$env:VIDEO_RESTART_API='1'; node apps/api/scripts/smoke-video.mjs` in PowerShell, then remove the shell variable when finished. This deliberately SIGKILLs and starts the local Compose API while a fixture task is running. Ordinary CI runs the script without that flag. The prototype remains single API replica; real provider cost guards are still Phase 11.

## Cost guard (Phase 11.1)

Run all now opens **Review estimated cost** before creating jobs. Cancel leaves usage unchanged. Node Run/Force rerun tooltips show estimates for the saved graph. Cache hits cost zero; Force rerun reserves provider credits again. Mock rates are simulated abstract credits, with no external charges.

`POST /api/spaces/:id/run/estimate` returns provider/cached node counts, units, per-node details and an approval fingerprint. Unresolved upstream generation makes the quote a conservative upper bound; Voiceover reserves up to its 5,000-character input maximum. Execution releases unused reservations. The confirmed graph content and cost caps are checked again before admission; camera/layout edits do not invalidate approval. Changed content, lost cache or higher prices require another review rather than silently increasing a reservation.

| Variable                   | Default | Purpose                                                 |
| -------------------------- | ------- | ------------------------------------------------------- |
| `MAX_BATCH_PROVIDER_NODES` | 100     | Maximum uncached provider nodes per batch or single run |
| `MAX_BATCH_UNITS`          | 1000    | Maximum reserved credits per batch or single run        |
| `DAILY_UNITS_LIMIT`        | 10000   | Daily credits per user, measured by UTC admission date  |

All limits accept zero. Over-limit admission returns 422 before queueing work. `GET /api/usage` reports the current user's usage, limit and remaining credits. Recreate the API after changing environment values. The normal Docker start remains `docker compose up --build -d`; database migrations run automatically.

Image credits are catalog rate × image count × resolution factor (512: 0.5, 1K: 1, 1.5K: 1.5, 2K: 2, 4K: 4). Video credits are rate × requested seconds × resolution factor (720p: 1, 1080p: 2). LLM uses a flat catalog rate; TTS uses rate per 1,000 effective UTF-16 characters, rounded up to 0.001 credit. Mock image/LLM/TTS base rates are 1 and mock video is 2. These are illustrative rates, not vendor pricing or money.

PostgreSQL records reserve, adjustment and refund entries. Admission and reservations commit together under a per-user lock, including concurrent daily-limit checks. Failure/cancel refunds are idempotent and reconciliation repairs interrupted refunds. Refunds apply to the original UTC budget day. Removing a workflow cancels/refunds active work and retains completed usage audit IDs. Existing runs from earlier phases keep their historical zero mock cost. The deployment still assumes one API instance.

Phase 11.2 is a rewrite based on official provider documentation. Shared groundwork, three OpenRouter adapters, the user-selected model catalog, Seedance (11.2c), Kling (11.2d) and the requested Veo integration (11.2e) are implemented. Defaults remain mocks; no billable calls are made by tests or CI. See `docs/PHASE_11_2_CHECKS.md`.

### OpenRouter checkpoint (11.2a / 11.2b)

Set `OPENROUTER_API_KEY` only in your local `.env` (optional). One key registers LLM, image and speech adapters together. `OPENROUTER_BASE_URL` optionally overrides the HTTPS API base; empty uses `https://openrouter.ai/api/v1`. Optional `OPENROUTER_APP_URL` / `OPENROUTER_APP_NAME` add attribution. `PROVIDER_CONCURRENCY_OPENROUTER` defaults to 2 and is shared across all three kinds. After editing the key/defaults in `.env`, apply them with `docker compose up -d --no-deps --force-recreate api`.

The catalog snapshot checked on 2026-11-19 contains 83 OpenAI/Google chat rows (text-only output, streaming not marked disabled, excluding batch variants), the 19 image models and 12 speech models selected by the user. Voices, context/output limits, image parameters and pricing come from official public catalogs and per-model endpoint records. Preview/deprecated rows are labeled; models explicitly shut down by upstream documentation remain listed but disabled. The default stays on mocks, and all remaining OpenRouter rows become selectable when the server key is configured.

Set `DEFAULT_IMAGE_MODEL`, `DEFAULT_LLM_MODEL` and `DEFAULT_TTS_MODEL` to the exact OpenRouter model ID to switch Auto defaults after configuring the key. For example, use `bytedance-seed/seedream-5-0-pro`, `openai/gpt-6.2-sol` and `elevenlabs/eleven-v4`. A saved explicit model choice also works while Auto remains mock. No key belongs in chat or git. `node scripts/dump-openrouter-models.mjs` remains a read-only discovery utility for later catalog updates; it performs only the three catalog GETs. Definitive image metadata/pricing comes from each model's endpoint URL stored alongside its prices.

Image controls expose the selected model's ratios and tiers, including 512 and 1.5K where supported. Models without a resolution parameter show Provider default; unsupported fields are omitted. Hiveflow retains its four-image-per-node limit even when the provider supports ten. Reference images are read from storage, with an application cap of 10 MB per image and 20 MB per base64-encoded request; max reference counts come from the endpoint records. Speech stays capped at 5,000 characters, exposes the exact catalog voices, and uses automatic language detection (English-only v2 models expose English). ElevenLabs v2 supports the documented 0.7-1.2 speed range; other selected speech models disable speed control. Google speech uses explicit PCM output and the standard OpenRouter speech body, then wraps PCM as WAV; no undocumented token-cap requirement or text-to-audio-token formula is imposed.

Build the API and run `node scripts/live-check.mjs openrouter` with `HIVEFLOW_LIVE_CHECK=1` and the key exported in the terminal. It uses an OpenRouter Auto default when selected, otherwise the first selected non-retired OpenRouter row for that kind; keeping application defaults on mocks does not block the CLI. This explicitly billable manual check makes one minimal generation per kind and reports generation IDs and API cost when available (speech may require an eventual generation lookup). It refuses to run without the flag/key or if any kind has no selected catalog model. CI never runs it. `node apps/api/scripts/check-provider-audio.mjs` is an offline check after build, probing the committed silent MP3 fixture and PCM-to-WAV output.

Media enters real adapters from storage bytes as base64 in the format accepted by each provider. Generated images/audio/video go through the existing asset storage path; provider result URLs are never persisted. OpenRouter's current Image API is all-or-nothing; see the documented differences in `docs/DECISIONS.md`.

### Seedance checkpoint (11.2c)

Set `ARK_API_KEY` in local `.env` and activate the desired model in the ModelArk console. `ARK_BASE_URL` defaults to `https://ark.ap-southeast.bytepluses.com/api/v3`; `PROVIDER_CONCURRENCY_SEEDANCE` defaults to 2. A key enables the catalog locally; account activation, project permissions and balance are verified by the provider when called. Auto still defaults to mock video unless `DEFAULT_VIDEO_MODEL=seedance-2-0` or `seedance-2-5` is explicitly configured.

Both models accept a text-only prompt or a start image plus optional end image. Seedance 2.0 offers 4–15 seconds; 2.5 offers 4–30 seconds and follows the start image's ratio. Both offer 480p/720p/1080p/4K and an audio toggle. The app caps images at 10 MB, prompt text at 2,500 characters and checks dimensions/ratio before submission. Real-person input rejection has a readable error. HEVC/10-bit results at high resolutions may require compatible system codecs or an external player.

Accepted task IDs are checkpointed before polling, including after worker restart. Video bytes are downloaded immediately through the SSRF-safe downloader and streamed into asset storage; result URLs are transient. Cancel can cancel queued provider tasks; a running task may still be billed after local cancel or timeout. The provider task expiry is one hour; the application video timeout remains independently configurable.

After `npm run build`, a user can explicitly run `node scripts/live-check.mjs seedance` with `HIVEFLOW_LIVE_CHECK=1` and `ARK_API_KEY` in the shell environment. This creates one billable 4-second/480p task, prints its ID and completion token count, and consumes/discards the downloaded bytes. It does not load `.env`, retry submissions or claim actual dollar cost. No live generation is run by acceptance tests.

On PowerShell, a manual live check can load the key from your local file without pasting it into a command: `$env:HIVEFLOW_LIVE_CHECK='1'; node --env-file=.env scripts/live-check.mjs openrouter`. Clear the opt-in afterward with `Remove-Item Env:HIVEFLOW_LIVE_CHECK`. `node scripts/check-openrouter-live-check.mjs` instead checks the CLI with an injected offline transport and never reaches a provider.

### Kling checkpoint (11.2d)

Set the current bearer `KLING_API_KEY` in local `.env`; `KLING_BASE_URL` defaults to `https://api-singapore.klingai.com` and `PROVIDER_CONCURRENCY_KLING` defaults to 2. This uses the current `/image-to-video/{model}` API and `/tasks` polling. It does not generate JWTs. Configuring a key enables the two catalog rows locally; model/resource-package access and credit are checked by Kling on each call. To change Auto explicitly, set `DEFAULT_VIDEO_MODEL=kling-3-0-turbo` or `kling-3-0`; defaults otherwise remain mocks.

Both models require a start image, follow its aspect ratio and offer 3–15 seconds. Turbo supports 720p/1080p, first frame only and included native audio (no audio toggle). Standard 3.0 adds an optional end frame, 4k and an audio toggle. Image inputs are validated JPEG/PNG storage bytes encoded as raw Base64, capped by the application at 10 MB with sides at least 300 px and ratio 0.4–2.5. The current official pages allow 50 MB; the app deliberately retains a smaller cap. Prompt caps are 2,500 characters for Turbo and 3,072 for standard.

Accepted tasks are checkpointed and resume through GET only. Results are downloaded immediately and streamed into owned assets. No cancellation endpoint is documented for this API, so Cancel stops local processing; the provider task can continue and be billed. An uncertain submit must be checked in the Kling developer console before manually retrying. Cost estimates use abstract application units; catalog pricing records the provider's unit-per-second rates without inventing a USD conversion.

After `npm run build`, manually run `node scripts/live-check.mjs kling <local-png-or-jpeg>` with `HIVEFLOW_LIVE_CHECK=1` and `KLING_API_KEY` set in the shell. It submits one billable 3-second/720p task using that image and consumes/discards the result bytes. Mock defaults choose Turbo for this check; an explicit Kling default chooses that model. The CLI reports the task ID and documented billing when returned; `costUsd` stays null unless every billing row is USD cash. It does not load `.env` or retry submissions. Automated CLI acceptance replaces both HTTP and downloads with offline fixtures.

### Veo checkpoint (11.2e)

Set `GOOGLE_CLOUD_PROJECT_ID` and `GOOGLE_CLOUD_SERVICE_ACCOUNT_JSON` in local `.env`. The latter is the complete service-account JSON key, preferably a single-quoted one-line JSON value so the JSON-escaped newlines in `private_key` remain intact. Do not commit it. Both variables are needed; ambient application default credentials are not used. The official `google-auth-library` obtains and refreshes OAuth access tokens with cloud-platform scope. Enable the Vertex AI API, billing, service-account IAM permissions and model access/quota in the target Google Cloud project. Configured credentials mean locally available, not proof that these permissions are granted.

The regional endpoint is fixed to `us-central1`. `PROVIDER_CONCURRENCY_VEO` defaults to 2. To change Auto explicitly, use `DEFAULT_VIDEO_MODEL=veo-3-1` or `veo-3-1-fast`; defaults otherwise remain mocks. Both selected GA models support text-only prompts and optional first/last frames (an end frame requires a start frame), 4/6/8 seconds, 16:9 or 9:16, and toggled audio. Standard supports 720p/1080p/4k; Fast is limited to the 720p/1080p published model capabilities even though the pricing page also lists a Fast 4k tier. Input images must be valid JPEG/PNG, at most 20 MB each; the shared 16 MP decoder guard remains. Prompt text is capped by the app at 2,500 characters.

One video is requested per run. The full operation name is checkpointed before polling and validated against the configured project, region and catalog model on resume. Input bytes go inline as Base64; `storageUri` is omitted so output bytes are returned inline. Only a canonical Base64 MP4 result is accepted. A `gcsUri` response is a clear unsupported-response error; Cloud Storage retrieval is outside this step. The decoded inline video cap is the smaller of `MAX_VIDEO_MB` and 64 MB, with a corresponding bounded JSON response. Inline responses must be buffered before decoding; the decoded bytes are then streamed into asset storage, and Base64 is never stored in Postgres. Local cancel does not cancel the provider operation and may still incur charges.

After `npm run build`, manually run `node scripts/live-check.mjs veo` with `HIVEFLOW_LIVE_CHECK=1` and both Google variables in the shell environment. It does not load `.env`. With mock Auto defaults it chooses Fast for one billable text-only 4-second/720p video with audio off; an explicit Veo default chooses that model. It prints the operation ID and consumes/discards the result bytes. The API does not report dollar cost here, so `costUsd` is null. Automated CLI checks replace OAuth and provider HTTP before execution; no real credentials or generation are used.
