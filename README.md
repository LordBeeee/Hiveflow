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
npm exec -w @hiveflow/web -- playwright install chromium  Install the E2E browser once
npm run test:e2e -w @hiveflow/web   Run the browser execution smoke check
docker compose up -d --build  Build and run the whole application
docker compose stop          Stop all containers, preserving them for Docker Desktop Start
docker compose start         Start existing containers
docker compose down          Remove containers, preserving named volumes
```

CI uses `npm ci`, then build, typecheck, lint, and unit tests. It prepares PostgreSQL, Redis and MinIO, applies migrations, runs all six API integration scripts, and installs Chromium for the Playwright smoke test. Scripts use root `.env` (environment values take precedence) and `API_BASE_URL` (default `http://127.0.0.1:3000`); they create and clean up only their own fixtures. Run execution checks with `MOCK_FAILURE_RATE=0` and the default provider timeout. E2E uses `E2E_BASE_URL` (default `http://127.0.0.1:5173`), reuses a running Docker web app locally, or starts Vite against an already running API in CI. Its UI-created Space is removed afterward; object garbage collection follows the prototype's deferred cleanup policy.

## Saved Spaces

Open the home page to create, open, or delete a Space. Each Space has a permanent `/spaces/:id` URL. Rename it in the canvas header. Edits and viewport changes autosave after approximately 800 ms, with one request in flight at a time. The header shows Saved, Unsaved changes, Saving, Save failed, or Conflict.

If another tab saves first, your tab keeps its local edits and stops writing. Choose **Reload saved version** to discard the local edits, or **Save as copy** to preserve them in a new Space. A failed save has a **Retry save** control. **Spaces** in the header waits for pending saves before returning to the list. The browser also guards navigation while changes remain unsaved; browser settings and user activation determine how the native warning is displayed.

Graph writes validate node params, port compatibility, existing endpoints, duplicate IDs/edges, and cycles. Invalid input returns 400 with `errors: [{ path, message }]`. PATCH requires the current `version`; stale versions return 409. The prototype uses a fixed dev user while retaining ownership checks on every Space operation.

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
| `WORKER_CONCURRENCY`                                                      | Global queue worker parallelism (default 6)                                                 |
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

Phases 0–9 are implemented. Next are Video Generator and cost guards/real providers in Phases 10–11. See `docs/PHASE_3_CHECKS.md` through `docs/PHASE_9_CHECKS.md` for verification evidence. The default provider remains a mock. Production work includes real authentication, shared event/rate-limit infrastructure for multiple API replicas and orphan-object cleanup.

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

The platform understands text/image/audio/video ports and output metadata. Audio/video storage accepts bounded bytes or streams with MIME signature checks; user uploads remain image-only. Stream buffering is size-bounded here; multipart streaming, playback/Range and video scheduling arrive in Phase 10. The mock video catalog registration reserves its contract until Phase 10. Mock LLM and TTS are executable through Assistant and Voiceover.

## Assistant (Phase 8)

Search **assist** in the picker to add Assistant under Text. Enter a message (up to 8,000 characters), choose Free form, Prompt improver, Image to prompt or Script writer, then Run. Connect multiple Text/Assistant outputs to its **context** input; their texts are joined in saved edge order, followed by the local message. The complete joined context must fit 20,000 characters; excess context is rejected without truncation. Empty instructions are allowed when images are connected.

Connect uploaded/generated images to **images** for vision models. Mock Assistant supports images; Mock Assistant Text deliberately does not, and running it with images gives a clear error before any provider request. The mock downloads signed references and echoes their content fingerprints; it does not perform visual analysis. Assistant Studio is an unavailable custom-adapter example. All generation remains local mock behavior without real AI credentials.

Results are read-only, selectable and scrollable, with a Copy button. Failed clipboard permission shows a manual-copy hint. Connect Assistant's purple **text** output to Image Generator's prompt and use **Run all** to execute Text → Assistant → Image Generator in dependency order. Cache hits, stale propagation, cancellation, refresh recovery and previous successful output retention work as for image nodes.

Assistant currently returns one completed response, with no token streaming. Stored output is capped at 20,000 characters. Preset system prompts live in `packages/shared/src/assistant-presets.ts`; bump `ASSISTANT_PRESETS_VERSION` whenever they change. That registry execution version participates in the same FE/API hash. Repeated inputs intentionally reuse the previous LLM result, even though a real LLM may be nondeterministic; use **Force rerun** to request a fresh completion. The mock remains deterministic after Force rerun. No new dependencies, environment variables or database migration are needed for Phase 8.

## Voiceover (Phase 9)

Search **voice** or choose **Audio → Voiceover** in the picker. Write a script (up to 5,000 characters), select the model, voice, language and speed, then Run. Speed uses steps of 0.05 from 0.75× to 1.50×, within the selected model's range. Voice/language choices come from that model's capabilities. Changing the model adjusts unsupported settings in one Undo step; **Mock Narrator** exercises this with a narrator voice, English and a narrower speed range.

Connect Text or Assistant's purple text output to **script**. The connected value overrides the preserved local script and disables local editing; disconnect to restore it. Empty or oversized connected scripts fail clearly rather than falling back or silently truncating. For a complete workflow, connect Text → Assistant (**Script writer**) → Voiceover and use Run all.

The completed audio appears in a native player with duration and Download audio. Cache, Force rerun, stale propagation, cancel and refresh recovery work as for other generating nodes. Audio metadata is stored in PostgreSQL; WAV bytes live in MinIO. Downloads carry `audio/wav` and a `.wav` filename.

**The mock creates soft tone patterns, not spoken narration.** It writes valid 16 kHz, mono, 16-bit PCM WAV directly in Node, without another package or external TTS account. Duration approximates word count ÷ 2.5 ÷ speed, with a minimum of 0.2 seconds and a maximum of five minutes. Tone patterns depend on script/voice/language/model so input changes are audible. Words are counted by whitespace; language selection is metadata for this mock, not pronunciation. Voice Studio is an unavailable custom-adapter example. Real speech providers remain Phase 11 behind cost guards; HTTP Range and multipart streaming remain Phase 10. No new environment variable, migration or dependency was added.
