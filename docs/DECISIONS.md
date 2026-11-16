# Decisions

- Implement one phase at a time and stop after Phase 0, as requested by the plan; canvas and domain behavior begin in Phase 1.
- Use Node 22 LTS in `.nvmrc` and CI while retaining the plan's Node >=20 / npm >=10 engine contract.
- Compile shared to CommonJS for NestJS; explicitly include the linked package in Vite dependency optimization and production CommonJS conversion so both apps consume `dist`.
- Install only dependencies used by the scaffold; canvas, state, queue, storage, and execution dependencies will be added in their corresponding phases.
- Add standard build/tooling dependencies (Nest CLI, TypeScript, ESLint tooling, React types, PostCSS, autoprefixer, ts-node, and ts-jest) to support the stack prescribed by the plan.
- Keep database schema synchronization and automatic migrations disabled. Phase 2 will introduce the first entity/migration; run migrations explicitly before starting deployments.
- Use a private MinIO bucket with bounded bootstrap retries. Public/signed asset access belongs to Phase 3.
- Bind infrastructure ports to localhost and provide development-only example credentials; production must supply its own credentials.
- The health endpoint indicates application readiness: Nest only starts listening after the database connects. Redis and storage readiness will be covered when those integrations are introduced.
- Run empty test suites successfully during scaffold; meaningful graph and orchestration tests are introduced with their phases.
- Do not remove assets on node deletion because undo may restore nodes; add orphan asset cleanup in future work.
- Use Rollup's official WASM distribution via an npm override: this Windows machine blocks the native `.node` module through Application Control, including outside the sandbox. This keeps Vite/Vitest portable without changing machine policy.
- Use Zod 4.6.7+ and Vitest 4.1.12+ after registry audit identified security fixes missing from older major versions; Vitest 4 retains the plan's Node 20 compatibility.
- Build local MinIO/MC containers from pinned official Go module revisions: Docker Hub repositories cannot be pulled and Quay returns 401 in this environment. Keep the existing S3 interface/Compose service names and persist data in the existing volume. Upstream community repositories are archived; reassess maintained storage before production.
- Make the database host port configurable with `POSTGRES_PORT`; this machine already has another PostgreSQL listener on 5432, so its uncommitted `.env` uses 5433 with a matching `DATABASE_URL`.
- Document `up -d` for the full stack: Compose `--wait` reports the successful one-shot `minio-init` exit as an error; use `--wait` only with the long-running services.
