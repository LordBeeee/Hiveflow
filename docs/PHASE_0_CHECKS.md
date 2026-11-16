# Phase 0 verification

## Local checks (2026-11-16)

- `npm install`: passed; committed a single root lockfile.
- `npm ci`: passed; subsequent build, typecheck, lint, and test commands also passed from the clean install.
- `npm run build`: passed for shared, API, and web using Rollup WASM.
- `npm run typecheck`: passed for all three workspaces.
- `npm run lint`: ESLint and formatting passed.
- `npm test`: all workspace commands passed with no test files, as expected for scaffold. This is not graph or execution coverage.
- `docker compose config --quiet`: passed.
- Vite HTTP smoke: the page, transformed TSX module, and prebundled shared dependency returned HTTP 200; the page title and shared runtime value contain `Hiveflow`.
- Infrastructure/API checks were initially blocked by an unavailable Docker Engine. The follow-up verification below resolves that gap. CI also includes a PostgreSQL service and an HTTP health check.

## Docker startup fix verification (2026-11-16)

- Reproduced unavailable MinIO container images; Quay also returned 401. Replaced external MinIO images with local builds from pinned upstream Go module revisions.
- `docker compose up --build -d`: both MinIO/MC images built successfully; Postgres and Redis images pulled successfully.
- Port 5432 was occupied by another local listener. Added configurable `POSTGRES_PORT`, then set local `.env` and its database URL to 5433.
- `docker compose up -d`: passed; Postgres/Redis healthy, MinIO running, bucket bootstrap exits with code 0 and creates `hiveflow-assets`.
- MinIO `/minio/health/ready`: HTTP 200.
- Started the compiled API temporarily on port 3107 against the actual Compose PostgreSQL instance; `/health` returned HTTP 200 with `{"status":"ok","app":"Hiveflow"}`. Stopped the temporary API after checking; infrastructure remains running for `npm run dev`.
- Compose `--wait` reports the successful one-shot bootstrap exit as an error; README now uses `up -d` for the full stack.
- `npm run lint`, `docker compose config --quiet`, and `git diff --check`: passed.

## Remaining observations

- Dependency audit after updating Zod and Vitest: 18 low/moderate findings remain in indirect dependencies; no high/critical findings. Remaining automatic fixes propose major upgrades, so they were not applied blindly.
- The scaffold's CommonJS shared package causes the web build to include more Zod code than necessary (approximately 656 kB minified JS). Revisit dual ESM/CommonJS exports before expanding the frontend; this affects bundle size, not correctness.
- Phase 1 has not started. Its graph utilities, canvas nodes, and tests are still pending.
