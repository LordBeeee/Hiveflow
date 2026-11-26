> Historical record: demo Mock/Custom providers and their integration scripts were removed. Use README.md for the current real-provider setup and offline test commands.

# Hiveflow — Spaces Prototype Implementation Plan

The project is **Hiveflow**. This plan covers its first feature: a node-based workflow canvas ("Spaces", like magnific.com/app/spaces). In this plan, "Space" is the name of that feature and its DB entity, not the project name. Users place nodes on an infinite canvas, connect them, and run them to generate images. This is a **prototype**: prioritize a clean architecture and a working end-to-end loop over polish.

---

## 0. Scope

**In scope**
- Infinite canvas: pan, zoom, drag nodes, connect nodes with edges, undo/redo
- Node types: `text`, `image_upload`, `image_generator`
- Persisted spaces (autosave)
- Run a single node, then run the whole graph
- Async execution with live status, result caching, stale detection
- Provider abstraction for image generation (a mock provider ships by default)

**Out of scope (do NOT build)**
- Auth / multi-user (use a hardcoded dev user, see §4.3)
- Billing / credits, realtime collaboration (CRDT/Yjs), sharing links
- Video / upscale / other node types, comments, sticky notes, shapes
- Mobile layout

---

## 1. Working agreements

1. Work **one phase at a time** (§5). At the end of each phase: run the acceptance checks, commit, and stop with a short summary (what was done, what was assumed, what is left). Do not start the next phase until told to.
2. If a requirement is ambiguous, pick the simplest option, record it in `docs/DECISIONS.md` (one bullet: decision + reason), and continue. Do not stall.
3. Do not add dependencies beyond §2 without writing the reason in `docs/DECISIONS.md`.
4. TypeScript `strict: true` everywhere. No `any` in `packages/shared`.
5. Graph logic (cycle detection, topological sort, input hashing, port validation) must be **pure functions in `packages/shared` with unit tests**. They run on both FE and BE.
6. Never store binary data or base64 in Postgres. Images live in object storage; the DB stores metadata and URLs only.
7. Config via `.env`; commit `.env.example`; never commit secrets.
8. Small, logical commits. Conventional commit messages (`feat:`, `fix:`, `chore:`, `test:`).
9. If you notice a design in this plan that will cause a regression or rework later, say so in your summary instead of silently following it.

---

## 2. Tech stack

| Concern | Choice |
|---|---|
| Monorepo | npm workspaces (Node 20+, npm 10+), single root `package-lock.json` |
| Dev task runner | `concurrently` (npm workspaces run scripts sequentially, not in parallel) |
| Frontend | React 18 + Vite + TypeScript |
| Canvas | `@xyflow/react` (React Flow v12) |
| FE state | Zustand (+ `zundo` for undo/redo) |
| FE data fetching | TanStack Query |
| Styling | Tailwind CSS |
| Backend | NestJS + TypeScript |
| DB | PostgreSQL 16 + TypeORM (migrations only, `synchronize: false`) |
| Queue | BullMQ + Redis |
| Object storage | S3-compatible (MinIO in docker-compose) via a `StorageService` interface |
| Realtime | Server-Sent Events (SSE) |
| Validation | zod (schemas shared between FE and BE) |
| Image processing | `sharp` (mock provider, thumbnails, dimensions) |
| Tests | Vitest (shared, web), Jest (api), one Playwright smoke test at the end |

---

## 3. Repo layout

```
hiveflow/
├─ apps/
│  ├─ web/                 # React + Vite
│  │  └─ src/
│  │     ├─ canvas/        # React Flow setup, custom nodes, toolbars
│  │     ├─ nodes/         # one folder per node type (UI component)
│  │     ├─ store/         # zustand stores (graph, ui, runs)
│  │     ├─ api/           # typed API client + SSE hook
│  │     └─ pages/
│  └─ api/                 # NestJS
│     └─ src/
│        ├─ spaces/        # CRUD, graph persistence
│        ├─ runs/          # run orchestration, node_runs, SSE
│        ├─ executors/     # one executor per node type
│        ├─ providers/     # ImageProvider interface + adapters
│        ├─ assets/        # upload + storage
│        └─ queue/         # BullMQ processors
├─ packages/
│  └─ shared/              # node registry, zod schemas, graph utils, types
│     └─ src/
│        ├─ nodes/         # NodeDef per type
│        ├─ graph/         # validate, cycle, toposort, hash
│        └─ types.ts
├─ docs/DECISIONS.md
├─ docker-compose.yml      # postgres, redis, minio
└─ SPACES_PLAN.md
```

---

## 4. Domain model

### 4.1 Graph document (stored as jsonb in `spaces.graph`)

```ts
type PortType = 'text' | 'image';

interface SpaceGraph {
  schemaVersion: 1;                       // bump + migrate when node params change shape
  nodes: GraphNode[];
  edges: GraphEdge[];
  viewport: { x: number; y: number; zoom: number };
}

interface GraphNode {
  id: string;                             // uuid, generated on FE
  type: 'text' | 'image_upload' | 'image_generator';
  position: { x: number; y: number };
  params: Record<string, unknown>;        // validated by the node's zod schema
}

interface GraphEdge {
  id: string;
  source: string;  sourceHandle: string;  // output port id
  target: string;  targetHandle: string;  // input port id
}
```

### 4.2 Node registry (`packages/shared/src/nodes`)

One definition per node type. FE renders from it, BE validates/executes from it.

```ts
interface NodeDef<P> {
  type: string;
  label: string;
  inputs:  { id: string; type: PortType; required?: boolean; multiple?: boolean }[];
  outputs: { id: string; type: PortType }[];
  paramsSchema: z.ZodType<P>;
  defaultParams: P;
}
```

MVP node definitions:

| type | inputs | outputs | params |
|---|---|---|---|
| `text` | – | `text`: text | `value: string` |
| `image_upload` | – | `image`: image | `assetId: string \| null` |
| `image_generator` | `prompt`: text (optional), `references`: image (optional, `multiple`) | `image`: image | `prompt: string`, `count: 1–4`, `model: 'auto' \| string`, `aspectRatio: '1:1' \| '16:9' \| '9:16' \| '4:3' \| '3:4'`, `resolution: '1K' \| '2K' \| '4K'` |

If a text node is connected to `prompt`, it overrides the node's own `params.prompt`.

### 4.3 Database (TypeORM migrations)

```
spaces
  id uuid pk, user_id uuid, name text,
  graph jsonb, schema_version int, version int (optimistic lock),
  created_at, updated_at

assets
  id uuid pk, space_id uuid, kind text ('image'), storage_key text, url text,
  mime text, size_bytes int, width int, height int, sha256 text, created_at

node_runs
  id uuid pk, space_id uuid, node_id text, batch_id uuid null,
  status text  -- queued | running | succeeded | failed | canceled | skipped
  input_hash text, params jsonb,
  output jsonb null            -- { image: [assetId, ...] } or { text: "..." }
  error text null, provider text null, cache_hit bool default false,
  created_at, started_at, finished_at
  index (space_id, node_id, created_at desc)
  index (input_hash)
  unique partial index (space_id, node_id, input_hash) WHERE status IN ('queued','running')
```

Dev user: a constant `DEV_USER_ID` injected by a `CurrentUser` decorator. Real auth replaces this later, so keep all ownership checks (`space.user_id === currentUser.id`) in place now.

### 4.4 Provider interface

```ts
interface ImageProvider {
  id: string;
  generate(
    req: {
      prompt: string;
      references: { url: string }[];
      count: number;
      aspectRatio: string;
      resolution: '1K' | '2K' | '4K';
      model: string;
    },
    signal: AbortSignal,
  ): Promise<{
    images: { bytes: Buffer; mime: string; width: number; height: number }[];
    costCredits?: number;
  }>;
}
```

- `MockImageProvider` (default): waits 2–4 s, returns a deterministic gradient PNG with the prompt rendered on it (via `sharp`), respects `aspectRatio`/`resolution`. Env `MOCK_FAILURE_RATE` (0–1) makes it fail randomly, to test error paths.
- Real providers: one file per provider in `providers/`, selected by `IMAGE_PROVIDER` env. Leave a documented stub; do not hardcode any vendor in executors.

---

## 5. Phases

### Phase 0 — Scaffold

- npm workspaces: root `package.json` with `"workspaces": ["apps/*", "packages/*"]`, `"engines": { "node": ">=20", "npm": ">=10" }`, `.nvmrc`; commit `package-lock.json`; use `npm ci` in CI
- Local packages depend on each other as `"@hiveflow/shared": "*"` (npm has no `workspace:*` protocol)
- Root scripts: `dev` (via `concurrently`: `tsc -w` for `packages/shared`, api, web), `build` (shared first, then api and web), `test`, `lint`, `typecheck`; per-package commands use `npm run <script> -w @hiveflow/<name>`
- `packages/shared` compiles to `dist/` (`main`/`types`/`exports` point there); apps consume the built output, so `dev` must keep `tsc -w` running for shared
- Each package lists its **own** dependencies in its `package.json`: npm hoists everything to the root, so a missing declaration works locally and breaks in a clean install. Enforce with ESLint `import/no-extraneous-dependencies` (per-package `packageDir`)
- TS configs, ESLint + Prettier, shared tsconfig base
- `docker-compose.yml`: postgres, redis, minio (+ bucket bootstrap)
- NestJS app boots with config module, DB connection, health endpoint
- Vite app boots with Tailwind
- `packages/shared` builds and is imported by both apps
- Naming: workspace packages are `@hiveflow/web`, `@hiveflow/api`, `@hiveflow/shared`; Postgres database/user `hiveflow`; MinIO bucket `hiveflow-assets`; page `<title>` and app header say "Hiveflow"

**Acceptance:** `npm install && docker compose up -d && npm run dev` starts shared (watch), web and api; `GET /health` returns 200; web imports a type from `@hiveflow/shared` without errors.

### Phase 1 — Canvas (frontend only, no backend)

- Full-screen React Flow canvas with dotted background, pan/zoom, zoom % indicator (bottom right)
- Left vertical toolbar: **Add node (+)** menu, **Select**, **Hand (pan)**, **Undo**, **Redo**
- `ImageGeneratorNode` custom node, modeled on Magnific's:
  - Title "Image Generator #N" above the card
  - Large preview area (empty state = grey placeholder)
  - Bottom of card: **+** button (attach references), prompt textarea ("Describe the image you want to generate…"), then a row with count (`x1`, −/+), model (`Auto`), aspect ratio (`1:1`), resolution (`1K`), **Run** button
  - Input handles on the left (text, image), output handle on the right (image)
  - Floating toolbar above the selected node: Run, Delete
- `TextNode` (textarea, output handle) and `ImageUploadNode` (drop/choose a local file, preview via object URL for now)
- Connection rules enforced via `isValidConnection`: port types must match; no self-loops; no duplicate edge to a non-`multiple` input; **reject edges that create a cycle** (use the shared `wouldCreateCycle`)
- Zustand graph store is the single source of truth; React Flow is controlled from it. Undo/redo via `zundo`, ignoring viewport changes and transient drag state.
- Keyboard: `Delete` removes selection, `Ctrl/Cmd+Z` / `Ctrl/Cmd+Shift+Z` undo/redo, `Space` + drag pans.
- Shared graph utils with unit tests: `wouldCreateCycle`, `topoSort` (returns levels), `validateConnection`.

**Acceptance:** can add all 3 node types, connect compatible ports, incompatible/cyclic connections are refused, undo/redo works, unit tests for the graph utils pass.

### Phase 2 — Persistence

- Entities + migration for `spaces`
- Endpoints: `POST /spaces`, `GET /spaces`, `GET /spaces/:id`, `PATCH /spaces/:id` (body: `{ graph?, name?, version }`), `DELETE /spaces/:id`
- On every write: validate the graph with zod (node params via the registry; edges reference existing nodes/ports; no cycles). Return 400 with field-level errors on failure.
- Optimistic concurrency: `PATCH` with a stale `version` → `409`; increment `version` on success.
- FE: spaces list page, open a space, **autosave** (debounce ~800 ms, coalesced, one in-flight request at a time), save-status indicator (saving / saved / error / conflict), `beforeunload` guard while dirty.
- `schemaVersion` is stored and checked on load (add a `migrateGraph(graph)` stub that is a no-op for v1).

**Acceptance:** edit, refresh, and the same graph + viewport comes back; two tabs editing the same space produce a visible conflict state instead of silent overwrite; invalid graphs are rejected by the API.

### Phase 3 — Run a single node (end to end)

- `StorageService` interface + S3/MinIO implementation; `assets` entity; `POST /assets` (multipart upload, size/mime limits, image only; compute sha256, width, height); `GET /assets/:id` redirects or streams.
- `ImageUploadNode` now uploads to the API and stores `assetId`.
- `ImageProvider` interface + `MockImageProvider`.
- BullMQ queue `node-runs`; processor loads the run, resolves inputs, calls the executor, stores output assets, updates `node_runs`.
- `POST /spaces/:id/nodes/:nodeId/run` → creates a `queued` run and returns `{ runId }`. It uses the **saved** graph, so the FE must flush autosave before calling it.
- SSE endpoint `GET /spaces/:id/events` emits `run.updated` events: `{ runId, nodeId, status, output?, error? }`. Include a heartbeat comment every 15 s; FE reconnects automatically.
- FE: Run button → node shows a loading state → preview shows the resulting image(s); failed runs show the error on the node with a Retry.
- Idempotency: a second Run while an identical run is `queued`/`running` returns the existing run (enforced by the partial unique index).

**Acceptance:** upload a reference image, type a prompt, click Run, see the mock image appear in the node; double-clicking Run creates one job; with `MOCK_FAILURE_RATE=1` the node shows an error and Retry works; refresh mid-run and the node recovers its status.

### Phase 4 — Data flowing through edges

- Input resolution in the executor: for each input port, follow edges to the source node and take its **latest succeeded** output for that port. Missing required upstream output → run fails fast with a clear message ("Upstream node 'Text #1' has no output").
- `text` node's output is its `params.value` (no job needed; resolved synchronously).
- `image_generator` uses connected text as the prompt and connected images as `references` (pass signed/presigned URLs to the provider).
- FE: edges colored by port type; show a small badge on the node when an input is connected so it's clear the local prompt is overridden.

**Acceptance:** Text → Image Generator → Image Generator (chained as a reference) works; disconnecting an upstream node produces a clear error instead of a crash.

### Phase 5 — Run graph, caching, staleness

- `input_hash = sha256(stableStringify({ type, params, inputs: [upstream asset sha256s or text values, sorted by port] }))` — pure function in `packages/shared`, unit-tested (key order must not matter).
- **Cache:** before queuing a node, if a `succeeded` run with the same `input_hash` exists, create a run with `cache_hit = true`, reusing the output and skipping the provider. `force: true` in the request bypasses the cache.
- **Stale:** FE computes the current hash for each node and compares with the latest run's `input_hash`; mismatch → "stale" badge. Never overwrite a newer node state with an older run's result.
- `POST /spaces/:id/run` (run all): create a `batch_id`, `topoSort` into levels, enqueue level by level (nodes in a level run in parallel; a level starts when the previous one finishes). If a node fails, all its downstream nodes get `skipped`.
- `POST /runs/:runId/cancel` and `POST /batches/:batchId/cancel`: remove queued jobs, abort running ones via `AbortSignal`, mark `canceled`, discard late provider results.
- Concurrency limits: per-space max parallel runs (env, default 3); global worker concurrency (env).
- Per-user rate limit on run endpoints (`@nestjs/throttler`).
- Playwright smoke test: create a space → add Text + Image Generator → connect → Run all → image visible.

**Acceptance:** Run all executes in dependency order; re-running without changes is instant (cache hit); changing an upstream prompt marks downstream nodes stale; canceling a batch stops pending nodes; smoke test passes in CI.

---

## 6. API summary

```
POST   /spaces                          create
GET    /spaces                          list
GET    /spaces/:id                      get (graph + version)
PATCH  /spaces/:id                      update (graph?, name?, version) → 409 on stale version
DELETE /spaces/:id

POST   /spaces/:id/nodes/:nodeId/run    body: { force?: boolean } → { runId }
POST   /spaces/:id/run                  body: { force?: boolean } → { batchId, runIds }
POST   /runs/:runId/cancel
POST   /batches/:batchId/cancel
GET    /spaces/:id/runs?nodeId=         run history for a node
GET    /spaces/:id/events               SSE: run.updated

POST   /assets                          multipart upload → asset
GET    /assets/:id                      redirect/stream
GET    /health
```

SSE event payload:

```json
{ "type": "run.updated", "runId": "…", "nodeId": "…", "batchId": null,
  "status": "succeeded", "cacheHit": false,
  "output": { "image": [{ "assetId": "…", "url": "…", "width": 1024, "height": 1024 }] },
  "error": null }
```

---

## 7. Edge cases to handle explicitly

- **Cycles:** rejected on connect (FE) and on save (BE). The topological sort must never see one.
- **Orphan edges:** deleting a node deletes its edges; the BE validation rejects edges pointing at missing nodes/ports.
- **Param schema drift:** unknown or invalid params on load → fall back to `defaultParams` for those fields and log a warning; don't crash the canvas.
- **Autosave vs run:** FE flushes autosave and awaits it before any run request.
- **Large uploads / wrong mime:** reject at the API with a clear 4xx; enforce limits in env (`MAX_UPLOAD_MB`).
- **Worker crash mid-run:** on startup, runs stuck in `running` older than a timeout are marked `failed` with reason `worker_lost`.
- **Provider timeouts:** wrap every provider call with a timeout (env) and the cancel `AbortSignal`.
- **Orphan assets:** don't delete assets on node deletion in the prototype (undo may bring the node back); note a cleanup job as future work in `docs/DECISIONS.md`.

---

## 8. Definition of done (whole prototype)

- A fresh clone runs with `npm ci && docker compose up -d && npm run dev`
- README explains setup, env vars, how to switch `IMAGE_PROVIDER`, and how to run tests
- Unit tests green for `packages/shared` graph utilities and for the runs orchestration (topo levels, skip-on-failure, cache hit, idempotency)
- Playwright smoke test green
- `docs/DECISIONS.md` lists every assumption made along the way
