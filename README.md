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
docker compose up -d --build  Build and run the whole application
docker compose stop          Stop all containers, preserving them for Docker Desktop Start
docker compose start         Start existing containers
docker compose down          Remove containers, preserving named volumes
```

CI uses `npm ci`, then build, typecheck, lint, and unit tests. It applies migrations and checks API CRUD, graph validation, ownership, and simultaneous writes against PostgreSQL. The integration smoke script uses `DATABASE_URL` from `.env` (or the environment) and `API_BASE_URL` (default `http://127.0.0.1:3000`); it creates and cleans up only its own fixture IDs.

## Saved Spaces

Open the home page to create, open, or delete a Space. Each Space has a permanent `/spaces/:id` URL. Rename it in the canvas header. Edits and viewport changes autosave after approximately 800 ms, with one request in flight at a time. The header shows Saved, Unsaved changes, Saving, Save failed, or Conflict.

If another tab saves first, your tab keeps its local edits and stops writing. Choose **Reload saved version** to discard the local edits, or **Save as copy** to preserve them in a new Space. A failed save has a **Retry save** control. **Spaces** in the header waits for pending saves before returning to the list. The browser also guards navigation while changes remain unsaved; browser settings and user activation determine how the native warning is displayed.

Graph writes validate node params, port compatibility, existing endpoints, duplicate IDs/edges, and cycles. Invalid input returns 400 with `errors: [{ path, message }]`. PATCH requires the current `version`; stale versions return 409. The prototype uses a fixed dev user while retaining ownership checks on every Space operation.

## Using the canvas

- Click **+** in the left toolbar to add Text, Image Upload, or Image Generator nodes. Each new Space starts with a Text node and an Image Generator.
- Drag a node by its title or preview area. Drag from an output port to an input port of the same color: purple for text, green for images. Connections that duplicate a single input or create a cycle are refused.
- Choose **Select** (`V`) to move/select nodes, or **Hand** (`H`) to pan. Hold **Space** while dragging to pan temporarily. Scroll to zoom; use the lower-right controls for zoom and Fit view.
- **Delete/Backspace** removes selected nodes/edges. **Ctrl/Cmd+Z** and **Ctrl/Cmd+Shift+Z** undo/redo graph edits; viewport changes are excluded. Editing a textarea retains its native keyboard behavior.
- Drop/choose an image in Image Upload for a local preview. The generator's **+** creates and connects a reference upload node. Local images stay available to undo/redo during the session.
- Graphs, names, node params, edges, and viewport now survive refresh. Local image previews still reset on reload/reopening: choose the file again until API uploads arrive in Phase 3. Binary image data is never stored in PostgreSQL. **Run** currently shows an availability notice, with actual generation planned for Phase 3.

## Configuration

Copy `.env.example` to root `.env`; the API and Compose read it. Never commit `.env`. After changing container environment settings, run `docker compose up -d` to recreate affected containers. Restart `npm run dev` when using the optional host workflow.

| Variable                                                                  | Purpose                                                                                   |
| ------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| `API_PORT`, `WEB_ORIGIN`                                                  | API listen port and permitted browser origin                                              |
| `DATABASE_URL`                                                            | API PostgreSQL connection string                                                          |
| `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB`                       | Local Compose database initialization                                                     |
| `REDIS_URL`                                                               | Queue connection, used from Phase 3                                                       |
| `MINIO_ROOT_USER`, `MINIO_ROOT_PASSWORD`                                  | Local MinIO administrator credentials                                                     |
| `S3_ENDPOINT`, `S3_REGION`, `S3_ACCESS_KEY`, `S3_SECRET_KEY`, `S3_BUCKET` | Object storage configuration, wired in Phase 3; keep credentials aligned with local MinIO |
| `IMAGE_PROVIDER`, `MOCK_FAILURE_RATE`                                     | Provider selection and failure injection, wired in Phase 3                                |
| `MAX_UPLOAD_MB`, `PROVIDER_TIMEOUT_MS`                                    | Upload/provider limits, wired in Phase 3                                                  |
| `SPACE_RUN_CONCURRENCY`, `WORKER_CONCURRENCY`                             | Queue limits, wired in Phase 5                                                            |

The optional Vite development server proxies `/health` and `/api/*` to port 3000. If changing the host API port for that workflow, update `apps/web/vite.config.ts` too. Docker's Nginx proxy uses the fixed internal API port. No frontend secrets are exposed.

Image generation is not implemented in this phase. Phase 3 will default `IMAGE_PROVIDER=mock`; real providers will require an adapter registered by that environment value, without vendor logic in executors.

## Layout and roadmap

- `apps/web`: frontend.
- `apps/api`: API and database configuration (`synchronize: false`).
- `packages/shared`: strict TypeScript types and schemas consumed by both apps.
- `docs/DECISIONS.md`: implementation assumptions.
- `SPACES_PLAN.md`: phase acceptance criteria and remaining prototype scope.

Next: Phase 3 single-node runs; Phase 4 connected inputs; Phase 5 graph execution, caching, and cancellation.
