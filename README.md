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
node apps/api/scripts/smoke-creations.mjs Test real adapters with offline responses in an isolated schema
node apps/api/scripts/smoke-library.mjs Test Library queries and downloads
npm exec -w @hiveflow/web -- playwright install chromium  Install the E2E browser once
npm run test:e2e -w @hiveflow/web   Run the browser execution smoke check
docker compose up -d --build  Build and run the whole application
docker compose stop          Stop all containers, preserving them for Docker Desktop Start
docker compose start         Start existing containers
docker compose down          Remove containers, preserving named volumes
```

CI runs build, typecheck, lint and unit tests, then PostgreSQL/Redis/MinIO checks. Generation integration checks use production adapters with injected offline HTTP responses in a disposable PostgreSQL schema. The creation-tool browser suite runs against that isolated API. No credentials or paid provider calls are used by CI.

## Saved Spaces

Home (`/`) offers Image, Video and Voice shortcuts and a short getting-started guide. These shortcuts open standalone creation forms; they do not create Spaces or canvas nodes. Open **Spaces** in the sidebar (`/spaces`) to search, create, open, or delete a Space. Home and Spaces have separate sidebar selection states; editor back navigation returns to `/spaces`. Each Space has a permanent `/spaces/:id` URL. Rename it in the canvas header. Edits and viewport changes autosave after approximately 800 ms, with one request in flight at a time. The header shows Saved, Unsaved changes, Saving, Save failed, or Conflict.

If another tab saves first, your tab keeps its local edits and stops writing. Choose **Reload saved version** to discard the local edits, or **Save as copy** to preserve them in a new Space. A failed save has a **Retry save** control. **Spaces** in the header waits for pending saves before returning to the list. The browser also guards navigation while changes remain unsaved; browser settings and user activation determine how the native warning is displayed.

Graph writes validate node params, port compatibility, existing endpoints, duplicate IDs/edges, and cycles. Invalid input returns 400 with `errors: [{ path, message }]`. PATCH requires the current `version`; stale versions return 409. The prototype uses a fixed dev user while retaining ownership checks on every Space operation.

## Standalone creation tools

Image (`/create/image`), Video (`/create/video`) and Voice (`/create/audio`) are standalone forms with model settings, prompt/script, reference uploads, a result preview, and the latest 50 generations. Sidebar icons, Home cards and the **+** menu all open these routes. Only **Space** in the **+** menu creates a workflow. Merely opening a tool performs reads; a per-user/tool session is created lazily when uploading a reference or submitting a generation. Form drafts are stored locally in the browser. History and output media persist on the server.

The tools share the existing model catalog, parameter validation/coercion, provider adapters, executors, queues, recovery, cancellation, cache and credit reservation/refund logic. Estimates show a conservative credit upper bound; admission verifies the estimate fingerprint and approved cap before queueing. Cache hits may cost less. No provider key or generation is required to view a tool.

The `ExecutionContexts1795200000000` migration backfills `execution_contexts` for existing Spaces and changes the existing asset/run foreign keys to this shared owner table. Existing `space_id` columns are retained as internal executor context keys. Standalone contexts contain no saved graph and no row in `spaces`; their public history uses `sessionId`. Space insert/rename/delete triggers maintain the corresponding context and existing deletion behavior. Public asset metadata retains its legacy context key for compatibility; Library's `sourceKind` distinguishes workflow media from standalone media. Ownership checks apply to both. Downgrade refuses to discard standalone contexts.

Endpoints: `GET /api/creations/:kind/runs`, `POST /api/creations/:kind/session`, `POST /api/creations/:kind/estimate`, and `POST /api/creations/:kind/runs`, where kind is `image`, `video` or `audio`. Run admission and session writes share the execution rate limiter; cancellation uses the existing `/api/runs/:id/cancel`. Inputs and references are snapshotted when submitting. References must belong to that user's tool session; cross-context media reuse is not enabled.

Rebuild both web and API in Docker (`docker compose up -d --build --no-deps web api`); API startup applies the migration. For local development, build shared and run `npm run migration:run` before starting the updated API. Vite optionally accepts `API_PROXY_TARGET` for a local API on another port; its default remains `http://localhost:3000`.

After building shared/API, `node apps/api/scripts/smoke-creations.mjs` runs an isolated PostgreSQL schema with in-memory storage and production adapters using offline HTTP transports. It checks migration backfill, generation for all three media types, uploads, history, costs/cache/cancel/refunds, ownership, Library and workflow compatibility, then drops its schema. `--serve` keeps the isolated API alive for browser tests and prints its address. Point a test Vite server at that address through `API_PROXY_TARGET`, then run `creations.spec.ts` with `E2E_BASE_URL` set to that Vite URL and `CREATIONS_TEST_API` set to the printed API address. The new browser tests skip when that isolated API is not explicitly provided. The harness injects fixed HTTP responses; it cannot call provider networks. Legacy demo-provider integration scripts have been consolidated into this harness and the executor, scheduler and accounting unit suites.

## Media Library

Open **Library** in the workspace sidebar (`/library`) to browse uploaded and generated images, videos and audio from your Spaces and standalone tools. Filter by media type or source Space; results are ordered newest first and paginated in groups of 24. Open a card to preview media, download the original stored file, or open its source Space/tool. The existing search field on the Spaces page still searches Space names.

Library uses existing asset metadata and storage. `GET /api/assets` accepts optional `kind`, `spaceId`, `offset` and `limit` (1–100, default 24), and returns only assets belonging to the current user through their execution contexts. Deleted Spaces and their media are excluded. `GET /api/assets/:id?download=1` serves an attachment with the same ownership and Range checks as inline playback. Direct Library uploads and cross-context asset reuse are outside this version.

After building shared and API, `node apps/api/scripts/smoke-library.mjs` checks the real PostgreSQL query and an isolated HTTP controller. It creates and removes only its own fixtures, uses an in-memory download stream, and starts no workers or providers. `npm run test:e2e -w @hiveflow/web -- library.spec.ts` checks the Library UI with mocked API responses and local media fixtures.

## Using the canvas

- Click **+** in the left toolbar or press **N** to open the node picker. Search by name/keyword, filter by Image or Text, navigate with **↑/↓**, and press **Enter** to insert. Search ignores case and diacritics. **Esc** closes the picker and restores focus to **+**. Insertion uses the current viewport with an offset for repeated additions; **Ctrl/Cmd+Z** undoes one insertion. N is ignored while typing in text fields or holding Ctrl/Cmd/Alt. Each new Space starts with a Text node and an Image Generator.
- Drag from an input or output port onto empty canvas to open a picker containing only compatible node types. Choose a node to insert it at the drop point and connect its first valid port automatically. One Undo removes both the node and its edge. Escape dismisses this picker; opening with N/plus afterward restores the full catalog.
- Drag a node by its title or preview area. Drag from an output port to an input port of the same color: purple for text, green for images. Connections that duplicate a single input or create a cycle are refused.
- Choose **Select** (`V`) to move/select nodes, or **Hand** (`H`) to pan. Hold **Space** while dragging to pan temporarily. Scroll to zoom; use the lower-right controls for zoom and Fit view.
- **Delete/Backspace** removes selected nodes/edges. **Ctrl/Cmd+Z** and **Ctrl/Cmd+Shift+Z** undo/redo graph edits; viewport changes are excluded. Editing a textarea retains its native keyboard behavior.
- Drop/choose an image in Image Upload. The generator's **+** creates and connects a reference upload node. Uploads accept PNG, JPEG, WebP, AVIF and GIF, up to `MAX_UPLOAD_MB` and 16 megapixels. The API validates the decoded format, normalizes orientation and stores a metadata-free PNG in MinIO. Animated uploads use the first frame. Existing local-only references from earlier phases must be selected again.
- Type a prompt directly in Image Generator, or connect a Text output to its purple prompt input. Set count/ratio/resolution and click **Run**. It waits for uploads and autosave, queues one execution, and displays the generated results when the configured provider completes. Errors offer **Retry**. Running status and outputs survive refresh; SSE reconnects and history snapshots recover missed events.
- Graphs, names, node params, edges, viewport, uploaded images and generated results survive refresh. Only image metadata is stored in PostgreSQL; bytes live in MinIO. Save-as-copy duplicates uploaded references into the new Space. Execution history/results remain with the original Space.

Connected Text replaces the local generator prompt; the purple badge names its source and the prompt field shows the connected value read-only. Disconnect the purple edge to restore the preserved local prompt. Text is read directly from the saved graph without running a job. An empty connected Text fails clearly, even if a local prompt exists.

Connect Image Upload or Image Generator outputs to a generator's green references input. Uploads use their saved asset directly. Single-node runs use **all images from the source's latest succeeded run**, even if a newer run is queued, running or failed. Run upstream generators first when using individual Run controls, or choose **Run all** to schedule dependencies automatically. A connected source without usable output produces a named error and Retry. Disconnecting references removes those optional inputs; disconnecting prompt uses the local prompt, or gives a clear missing-prompt error if it is empty.

Single-node runs snapshot connected values when requested. Run all snapshots the entire graph and prepares each dependency level using successful outputs from that batch. Later graph edits affect the next request. The worker creates private S3 GET URLs valid for 15 minutes and passes them to the provider; signed URLs are never stored in graph/run JSON. Reference content hashes participate in execution caching.

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
| `MAX_UPLOAD_MB`, `PROVIDER_TIMEOUT_MS`                                    | Upload MB limit (1–100, default 20) and executor timeout (default 120000 ms)                |
| `RUN_RECOVERY_TIMEOUT_MS`                                                 | Lost-worker cutoff; default provider timeout + 30000 ms, minimum provider timeout + 5000 ms |
| `WORKER_CONCURRENCY`                                                      | Fast queue worker parallelism (default 6; video has its own queue)                          |
| `SPACE_RUN_CONCURRENCY`                                                   | Maximum running nodes per Space (default 3); enforced when claiming queued work             |

The optional Vite development server proxies `/health` and `/api/*` to port 3000. If changing the host API port for that workflow, update `apps/web/vite.config.ts` too. Docker's Nginx proxy uses the fixed internal API port. No frontend secrets are exposed.

Generation uses the real OpenRouter, Seedance, Kling or Veo adapters registered from server-side credentials. Without configured credentials, the catalog remains visible but generation is unavailable. Provider errors are reported directly; there is no simulated-output fallback.

## Layout and roadmap

- `apps/web`: frontend.
- `apps/api`: API and database configuration (`synchronize: false`).
- `packages/shared`: strict TypeScript types and schemas consumed by both apps.
- `docs/DECISIONS.md`: implementation assumptions.
- `SPACES_PLAN.md`: phase acceptance criteria and remaining prototype scope.
- `NODES_PLAN.md`: continuation for node picker, platform generalization and additional media nodes.

Phases 0–10, Phase 11.1 (cost guards) and Phase 11.2 (provider integrations, including the requested optional Veo step) are implemented. See `docs/PHASE_3_CHECKS.md` through `docs/PHASE_11_2_CHECKS.md` for verification evidence. The runtime catalog contains real providers only. Production work includes real authentication, shared event/rate-limit infrastructure for multiple API replicas and orphan-object cleanup.

## Models and platform (Phase 7)

Image Generator loads its model menu from `GET /api/models?kind=image`. Every generation node and creation form requires an explicit model selection. Concrete model IDs and provider codes are recorded on each run; the backend never selects a model automatically.

Models are grouped by provider. Unavailable/removed models stay visible with a reason. Saved graphs may retain unknown or retired model IDs; opening them shows a warning, and running asks you to choose another model. Switching models adjusts unsupported settings and resets Advanced options in one Undo step. Advanced options come from the selected real model catalog entry.

Additional configuration:

| Variable                                                                 | Default / purpose                                                 |
| ------------------------------------------------------------------------ | ----------------------------------------------------------------- |
| `PROVIDER_MAX_RETRIES`                                                   | 2 retries for transient errors before a task is accepted          |
| `PROVIDER_CONCURRENCY_<CODE>`                                            | 2 running jobs per provider across kinds; uppercase provider code |
| `KIND_CONCURRENCY_IMAGE`, `KIND_CONCURRENCY_LLM`, `KIND_CONCURRENCY_TTS` | 6 running jobs per kind                                           |
| `KIND_CONCURRENCY_VIDEO`                                                 | 2 running jobs                                                    |
| `MAX_AUDIO_MB`, `MAX_VIDEO_MB`                                           | 25 / 250 MB for provider output storage                           |

Provider/kind limits add to existing Space/global limits. Capacity-blocked jobs remain queued. Retries honor Retry-After, cancellation and accepted-task guards. There are no external provider calls or new dependencies in this phase.

The platform understands text/image/audio/video ports and output metadata. Audio/video storage accepts bounded bytes or streams with MIME signature checks; user uploads remain image-only. Audio buffering is size-bounded; provider video is streamed through multipart S3 upload, with playback/Range and a separate video worker queue. Only configured real provider adapters are executable through generating nodes.

## Assistant (Phase 8)

Search **assist** in the picker to add Assistant under Text. Enter a message (up to 8,000 characters), choose Free form, Prompt improver, Image to prompt or Script writer, then Run. Connect multiple Text/Assistant outputs to its **context** input; their texts are joined in saved edge order, followed by the local message. The complete joined context must fit 20,000 characters; excess context is rejected without truncation. Empty instructions are allowed when images are connected.

Connect uploaded/generated images to **images** for vision models. The selected model must support image input; incompatible requests are rejected before provider submission.

Results are read-only, selectable and scrollable, with a Copy button. Failed clipboard permission shows a manual-copy hint. Connect Assistant's purple **text** output to Image Generator's prompt and use **Run all** to execute Text → Assistant → Image Generator in dependency order. Cache hits, stale propagation, cancellation, refresh recovery and previous successful output retention work as for image nodes.

Assistant currently returns one completed response, with no token streaming. Stored output is capped at 20,000 characters. Preset system prompts live in `packages/shared/src/assistant-presets.ts`; bump `ASSISTANT_PRESETS_VERSION` whenever they change. That registry execution version participates in the same FE/API hash. Repeated inputs intentionally reuse the previous LLM result, even though a real LLM may be nondeterministic; use **Force rerun** to request a fresh completion. No new dependencies, environment variables or database migration are needed for Phase 8.

## Voiceover (Phase 9)

Search **voice** or choose **Audio → Voiceover** in the picker. Write a script (up to 5,000 characters), select the model, voice, language and speed, then Run. Speed uses steps of 0.05 from 0.75× to 1.50×, within the selected model's range. Voice/language choices come from that model's capabilities. Changing the model adjusts unsupported settings in one Undo step.

Connect Text or Assistant's purple text output to **script**. The connected value overrides the preserved local script and disables local editing; disconnect to restore it. Empty or oversized connected scripts fail clearly rather than falling back or silently truncating. For a complete workflow, connect Text → Assistant (**Script writer**) → Voiceover and use Run all.

The completed audio appears in a native player with duration and Download audio. Cache, Force rerun, stale propagation, cancel and refresh recovery work as for other generating nodes. Audio metadata is stored in PostgreSQL; WAV bytes live in MinIO. Downloads carry `audio/wav` and a `.wav` filename.

Speech is generated by the configured provider. ElevenLabs returns MP3; Google PCM responses are wrapped as WAV. Duration is taken from the returned media metadata.

## Video Generator (Phase 10)

Choose Video → Video Generator in the picker. Enter a prompt or connect Text/Assistant output; the connected prompt overrides the preserved local prompt. Optional start/end image inputs accept Image Upload or Image Generator output. Duration, ratio, resolution and audio controls follow the selected model. Unsupported options remain visible but disabled. Changing models coerces dependent settings in one Undo step. A connected end image on an unsupported model displays a warning at the port and blocks Run until you disconnect it or choose another model.

Run all supports Text → Assistant → Image Generator / Voiceover / Video Generator. Video shows progress and elapsed time, supports Cancel, and plays/seeks in a native video player. Repeating unchanged work uses cache. Editing upstream text marks all affected outputs stale. Progress is volatile and emitted through existing SSE/history snapshots without a database write per poll.

Video output is generated by the selected real provider and stored as owned media. Completion time depends on the provider and requested settings.

Video uses its own BullMQ queue. Configuration additions:

| Variable                                               | Default / purpose                                                  |
| ------------------------------------------------------ | ------------------------------------------------------------------ |
| `IMAGE_TIMEOUT_MS`, `LLM_TIMEOUT_MS`, `TTS_TIMEOUT_MS` | 120000 ms, falling back to legacy `PROVIDER_TIMEOUT_MS` when unset |
| `VIDEO_TIMEOUT_MS`                                     | 900000 ms (15 minutes)                                             |
| `RUN_RECOVERY_TIMEOUT_MS`                              | largest kind timeout + 30000; must exceed it by at least 5000 ms   |
| `VIDEO_WORKER_CONCURRENCY`                             | 2, separate from the fast `WORKER_CONCURRENCY` queue               |

Upgrade old `.env` recovery values such as 150000 to at least 905000 with default video settings (example: 930000). Kind deadlines allow 1000–3600000 ms; recovery allows up to 7200000 ms. Local `.env` was raised to 930000 during this upgrade. Recreate API after environment changes.

Accepted video task IDs are checkpointed before polling. On API startup, unfinished video runs are requeued for polling with their existing task ID and original deadline. Provider acceptance is stored in PostgreSQL. Provider idempotency and remote cancellation follow each adapter’s documented capabilities. No automatic resubmission occurs after a task ID is recorded. Cancel requests remote task cancellation where supported, then stops local work; conditional updates discard late results.

Video output streams directly into size-capped S3 multipart uploads with sha256 calculated as bytes flow. Failed uploads abort/clean their object; metadata stores no bytes or signed URLs. Audio/video IDs are immutable and served with private one-hour caching; image responses retain no-store. Single byte ranges support bounded, open-ended and suffix requests, returning 206 or 416; Nginx forwards ranges and disables buffering for asset downloads. Object/incomplete multipart cleanup after hard crashes remains production lifecycle work.

## Cost guard (Phase 11.1)

Run all now opens **Review estimated cost** before creating jobs. Cancel leaves usage unchanged. Node Run/Force rerun tooltips show estimates for the saved graph. Cache hits cost zero; Force rerun reserves provider credits again. Real generation may incur provider charges in addition to application credits.

`POST /api/spaces/:id/run/estimate` returns provider/cached node counts, units, per-node details and an approval fingerprint. Unresolved upstream generation makes the quote a conservative upper bound; Voiceover reserves up to its 5,000-character input maximum. Execution releases unused reservations. The confirmed graph content and cost caps are checked again before admission; camera/layout edits do not invalidate approval. Changed content, lost cache or higher prices require another review rather than silently increasing a reservation.

| Variable                   | Default | Purpose                                                 |
| -------------------------- | ------- | ------------------------------------------------------- |
| `MAX_BATCH_PROVIDER_NODES` | 100     | Maximum uncached provider nodes per batch or single run |
| `MAX_BATCH_UNITS`          | 1000    | Maximum reserved credits per batch or single run        |
| `DAILY_UNITS_LIMIT`        | 10000   | Daily credits per user, measured by UTC admission date  |

All limits accept zero. Over-limit admission returns 422 before queueing work. `GET /api/usage` reports the current user's usage, limit and remaining credits. Recreate the API after changing environment values. The normal Docker start remains `docker compose up --build -d`; database migrations run automatically.

Image credits are catalog rate × image count × resolution factor (512: 0.5, 1K: 1, 1.5K: 1.5, 2K: 2, 4K: 4). Video credits are rate × requested seconds × resolution factor (720p: 1, 1080p: 2). LLM uses a flat catalog rate; TTS uses rate per 1,000 effective UTF-16 characters, rounded up to 0.001 credit. Credit rates come from each real catalog entry and are application units, not a wallet balance or an exact vendor invoice.

PostgreSQL records reserve, adjustment and refund entries. Admission and reservations commit together under a per-user lock, including concurrent daily-limit checks. Failure/cancel refunds are idempotent and reconciliation repairs interrupted refunds. Refunds apply to the original UTC budget day. Removing a workflow cancels/refunds active work and retains completed usage audit IDs. Existing runs from earlier phases keep their historical costs. The deployment still assumes one API instance.

Phase 11.2 is a rewrite based on official provider documentation. Shared groundwork, three OpenRouter adapters, the user-selected model catalog, Seedance (11.2c), Kling (11.2d) and the requested Veo integration (11.2e) are implemented. Each request names a concrete model; tests and CI use offline transport fixtures with no billable calls. See `docs/PHASE_11_2_CHECKS.md`.

### OpenRouter checkpoint (11.2a / 11.2b)

Set `OPENROUTER_API_KEY` only in your local `.env` (optional). One key registers LLM, image and speech adapters together. `OPENROUTER_BASE_URL` optionally overrides the HTTPS API base; empty uses `https://openrouter.ai/api/v1`. Optional `OPENROUTER_APP_URL` / `OPENROUTER_APP_NAME` add attribution. `PROVIDER_CONCURRENCY_OPENROUTER` defaults to 2 and is shared across all three kinds. After editing the key/defaults in `.env`, apply them with `docker compose up -d --no-deps --force-recreate api`.

The catalog snapshot checked on 2026-11-19 contains 83 OpenAI/Google chat rows (text-only output, streaming not marked disabled, excluding batch variants), the 19 image models and 12 speech models selected by the user. Voices, context/output limits, image parameters and pricing come from official public catalogs and per-model endpoint records. Preview/deprecated rows are labeled; models explicitly shut down by upstream documentation remain listed but disabled. OpenRouter rows become selectable when the server key is configured.

Select an exact model in the creation form or workflow node after configuring the provider key. No key belongs in chat or git. `node scripts/dump-openrouter-models.mjs` remains a read-only discovery utility for later catalog updates; it performs only the three catalog GETs. Definitive image metadata/pricing comes from each model's endpoint URL stored alongside its prices.

Image controls expose the selected model's ratios and tiers, including 512 and 1.5K where supported. Models without a resolution parameter show Provider default; unsupported fields are omitted. Hiveflow retains its four-image-per-node limit even when the provider supports ten. Reference images are read from storage, with an application cap of 10 MB per image and 20 MB per base64-encoded request; max reference counts come from the endpoint records. Speech stays capped at 5,000 characters, exposes the exact catalog voices, and uses automatic language detection (English-only v2 models expose English). ElevenLabs v2 supports the documented 0.7-1.2 speed range; other selected speech models disable speed control. Google speech uses explicit PCM output and the standard OpenRouter speech body, then wraps PCM as WAV; no undocumented token-cap requirement or text-to-audio-token formula is imposed.

Build the API and run `node scripts/live-check.mjs openrouter` with `HIVEFLOW_LIVE_CHECK=1` and the key exported in the terminal. The manual CLI uses `LIVE_CHECK_IMAGE_MODEL`, `LIVE_CHECK_LLM_MODEL` and `LIVE_CHECK_TTS_MODEL` when set, otherwise a catalog fixture-sized choice for each kind. These variables apply only to the explicitly opted-in CLI and do not choose models in the app. This explicitly billable manual check makes one minimal generation per kind and reports generation IDs and API cost when available (speech may require an eventual generation lookup). It refuses to run without the flag/key or if any kind has no selected catalog model. CI never runs it. `node apps/api/scripts/check-provider-audio.mjs` is an offline check after build, probing the committed silent MP3 fixture and PCM-to-WAV output.

Media enters real adapters from storage bytes as base64 in the format accepted by each provider. Generated images/audio/video go through the existing asset storage path; provider result URLs are never persisted. OpenRouter's current Image API is all-or-nothing; see the documented differences in `docs/DECISIONS.md`.

### Seedance checkpoint (11.2c)

Set `ARK_API_KEY` in local `.env` and activate the desired model in the ModelArk console. `ARK_BASE_URL` defaults to `https://ark.ap-southeast.bytepluses.com/api/v3`; `PROVIDER_CONCURRENCY_SEEDANCE` defaults to 2. A key enables the catalog locally; account activation, project permissions and balance are verified by the provider when called. Choose a Seedance model explicitly in each video tool or node.

Both models accept a text-only prompt or a start image plus optional end image. Seedance 2.0 offers 4–15 seconds; 2.5 offers 4–30 seconds and follows the start image's ratio. Both offer 480p/720p/1080p/4K and an audio toggle. The app caps images at 10 MB, prompt text at 2,500 characters and checks dimensions/ratio before submission. Real-person input rejection has a readable error. HEVC/10-bit results at high resolutions may require compatible system codecs or an external player.

Accepted task IDs are checkpointed before polling, including after worker restart. Video bytes are downloaded immediately through the SSRF-safe downloader and streamed into asset storage; result URLs are transient. Cancel can cancel queued provider tasks; a running task may still be billed after local cancel or timeout. The provider task expiry is one hour; the application video timeout remains independently configurable.

After `npm run build`, a user can explicitly run `node scripts/live-check.mjs seedance` with `HIVEFLOW_LIVE_CHECK=1` and `ARK_API_KEY` in the shell environment. This creates one billable 4-second/480p task, prints its ID and completion token count, and consumes/discards the downloaded bytes. It does not load `.env`, retry submissions or claim actual dollar cost. No live generation is run by acceptance tests.

On PowerShell, a manual live check can load the key from your local file without pasting it into a command: `$env:HIVEFLOW_LIVE_CHECK='1'; node --env-file=.env scripts/live-check.mjs openrouter`. Clear the opt-in afterward with `Remove-Item Env:HIVEFLOW_LIVE_CHECK`. `node scripts/check-openrouter-live-check.mjs` instead checks the CLI with an injected offline transport and never reaches a provider.

### Kling checkpoint (11.2d)

Set the current bearer `KLING_API_KEY` in local `.env`; `KLING_BASE_URL` defaults to `https://api-singapore.klingai.com` and `PROVIDER_CONCURRENCY_KLING` defaults to 2. This uses the current `/image-to-video/{model}` API and `/tasks` polling. It does not generate JWTs. Configuring a key enables the two catalog rows locally; model/resource-package access and credit are checked by Kling on each call. Choose `kling-3-0-turbo` or `kling-3-0` explicitly in the tool or node.

Both models require a start image, follow its aspect ratio and offer 3–15 seconds. Turbo supports 720p/1080p, first frame only and included native audio (no audio toggle). Standard 3.0 adds an optional end frame, 4k and an audio toggle. Image inputs are validated JPEG/PNG storage bytes encoded as raw Base64, capped by the application at 10 MB with sides at least 300 px and ratio 0.4–2.5. The current official pages allow 50 MB; the app deliberately retains a smaller cap. Prompt caps are 2,500 characters for Turbo and 3,072 for standard.

Accepted tasks are checkpointed and resume through GET only. Results are downloaded immediately and streamed into owned assets. No cancellation endpoint is documented for this API, so Cancel stops local processing; the provider task can continue and be billed. An uncertain submit must be checked in the Kling developer console before manually retrying. Cost estimates use abstract application units; catalog pricing records the provider's unit-per-second rates without inventing a USD conversion.

After `npm run build`, manually run `node scripts/live-check.mjs kling <local-png-or-jpeg>` with `HIVEFLOW_LIVE_CHECK=1` and `KLING_API_KEY` set in the shell. It submits one billable 3-second/720p task using that image and consumes/discards the result bytes. An unset default chooses Turbo for this check; an explicit Kling default chooses that model. The CLI reports the task ID and documented billing when returned; `costUsd` stays null unless every billing row is USD cash. It does not load `.env` or retry submissions. Automated CLI acceptance replaces both HTTP and downloads with offline fixtures.

### Veo checkpoint (11.2e)

Set `GOOGLE_CLOUD_PROJECT_ID` and `GOOGLE_CLOUD_SERVICE_ACCOUNT_JSON` in local `.env`. The latter is the complete service-account JSON key, preferably a single-quoted one-line JSON value so the JSON-escaped newlines in `private_key` remain intact. Do not commit it. Both variables are needed; ambient application default credentials are not used. The official `google-auth-library` obtains and refreshes OAuth access tokens with cloud-platform scope. Enable the Vertex AI API, billing, service-account IAM permissions and model access/quota in the target Google Cloud project. Configured credentials mean locally available, not proof that these permissions are granted.

The regional endpoint is fixed to `us-central1`. `PROVIDER_CONCURRENCY_VEO` defaults to 2. Choose `veo-3-1` or `veo-3-1-fast` explicitly in the tool or node. Both selected GA models support text-only prompts and optional first/last frames (an end frame requires a start frame), 4/6/8 seconds, 16:9 or 9:16, and toggled audio. Standard supports 720p/1080p/4k; Fast is limited to the 720p/1080p published model capabilities even though the pricing page also lists a Fast 4k tier. Input images must be valid JPEG/PNG, at most 20 MB each; the shared 16 MP decoder guard remains. Prompt text is capped by the app at 2,500 characters.

One video is requested per run. The full operation name is checkpointed before polling and validated against the configured project, region and catalog model on resume. Input bytes go inline as Base64; `storageUri` is omitted so output bytes are returned inline. Only a canonical Base64 MP4 result is accepted. A `gcsUri` response is a clear unsupported-response error; Cloud Storage retrieval is outside this step. The decoded inline video cap is the smaller of `MAX_VIDEO_MB` and 64 MB, with a corresponding bounded JSON response. Inline responses must be buffered before decoding; the decoded bytes are then streamed into asset storage, and Base64 is never stored in Postgres. Local cancel does not cancel the provider operation and may still incur charges.

After `npm run build`, manually run `node scripts/live-check.mjs veo` with `HIVEFLOW_LIVE_CHECK=1` and both Google variables in the shell environment. It does not load `.env`. With no explicit default it chooses Fast for one billable text-only 4-second/720p video with audio off; an explicit Veo default chooses that model. It prints the operation ID and consumes/discards the result bytes. The API does not report dollar cost here, so `costUsd` is null. Automated CLI checks replace OAuth and provider HTTP before execution; no real credentials or generation are used.

## Upgrade: real providers only

Mock and illustrative Custom models/providers have been removed from the runtime, along with their generator code, failure switches and demo assets. Configure at least one real provider key to generate content. Choose a specific model in each tool or node. Auto selection and `DEFAULT_*_MODEL` application settings have been removed; blank or legacy `auto` choices must be replaced before generating.

Remove legacy `IMAGE_PROVIDER`, `MOCK_FAILURE_RATE` and `PROVIDER_CONCURRENCY_MOCK*` settings from old environment files and legacy `DEFAULT_*_MODEL` settings. Existing saved graphs/drafts with removed model IDs require selecting a real model; they are not silently rewritten. Stored media and run history remain available. The new `RemoveDemoVideoTasks` migration drops only the obsolete provider's task bookkeeping table, preserving assets, runs and usage history.

Rebuild both services with `docker compose up -d --build --no-deps web api`; API startup applies pending migrations. Historical phase-check notes describe previous implementations and are not current setup instructions.

## Upgrade: explicit model selection

New generation nodes and creation drafts start with no model selected. Saved workflows and drafts containing `model: 'auto'` still open and preserve their content, but must select a concrete available model before execution. Run/Generate and batch admission block missing model selections. Saving incomplete drafts and workflows remains supported. Automatic speech-language detection and provider-specific automatic aspect-ratio/quality options are independent controls and remain available where supported.
