# Hiveflow

Hiveflow is a node-based image workflow prototype. **Phase 0 (scaffold)** is implemented: npm workspaces, a React/Vite/Tailwind frontend, a NestJS API with PostgreSQL connectivity, and a shared TypeScript package. The canvas is next.

## Local setup

Requires Node 20+ (Node 22 recommended), npm 10+, Docker Engine, and Docker Compose v2. Start Docker Desktop before running Compose.

```powershell
Copy-Item .env.example .env
npm ci
docker compose up -d --wait
npm run dev
```

Open <http://localhost:5173>. The API health endpoint is <http://localhost:3000/health> and returns `{"status":"ok","app":"Hiveflow"}` once PostgreSQL connects. MinIO's local console is at <http://localhost:9001>; credentials are in `.env`. The `minio-init` service creates the private `hiveflow-assets` bucket and exits successfully.

`npm run dev` builds shared first, then runs shared's TypeScript watcher, Nest's watcher, and Vite concurrently. Both apps import built output from `@hiveflow/shared`. Restart Vite if adding a new shared dependency changes dependency prebundling.

## Commands

```text
npm run build          Build shared, API, then web
npm run typecheck      Build shared and check all workspaces
npm run lint           ESLint dependency checks and Prettier
npm run format         Format source/configuration
npm test               Run workspace tests (empty suites allowed in Phase 0)
npm run migration:run  Apply API migrations (first migration arrives in Phase 2)
docker compose down   Stop local infrastructure, preserving named volumes
```

CI uses `npm ci`, then build, typecheck, lint, and tests. No graph/execution tests exist yet.

## Configuration

Copy `.env.example` to root `.env`; the API and Compose read it. Never commit `.env`. Configuration changes require restarting the API.

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

Vite proxies `/health` to port 3000. If changing `API_PORT`, update `apps/web/vite.config.ts` too. No frontend secrets are exposed.

Image generation is not implemented in this phase. Phase 3 will default `IMAGE_PROVIDER=mock`; real providers will require an adapter registered by that environment value, without vendor logic in executors.

## Layout and roadmap

- `apps/web`: frontend.
- `apps/api`: API and database configuration (`synchronize: false`).
- `packages/shared`: strict TypeScript types and schemas consumed by both apps.
- `docs/DECISIONS.md`: implementation assumptions.
- `SPACES_PLAN.md`: phase acceptance criteria and remaining prototype scope.

Next: Phase 1 canvas; Phase 2 persistence; Phase 3 single-node runs; Phase 4 connected inputs; Phase 5 graph execution, caching, and cancellation.
