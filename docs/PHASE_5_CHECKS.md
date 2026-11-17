# Phase 5 verification

Verified on 2026-11-17 against the Docker application and its PostgreSQL, Redis and MinIO services.

## Automated checks

- `npm run build`: shared, API and frontend production build passed.
- `npm run typecheck`: all workspaces, shared tests and the Playwright test/config passed.
- `npm run lint`: ESLint and Prettier passed.
- `npm test`: 95 unit tests passed (36 API, 24 web, 35 shared).
- `node apps/api/scripts/smoke-spaces.mjs`: Phase 2 persistence/concurrency checks passed.
- `node apps/api/scripts/smoke-runs.mjs`: upload, SSE/heartbeat, node idempotency, queue/lost-worker recovery and Phase 4 connected input checks passed.
- `node apps/api/scripts/smoke-batches.mjs`: real scheduling/cache/cancellation integration check. It covers concurrent Run all deduplication, parallel roots, strict level barriers, batch-local output resolution, instant succeeded cache, force bypass, single-node cache, running node cancellation, waiting/running batch cancellation with late results discarded, transitive skips with independent branch success, cross-Space global/per-Space limits, durable unprepared batch recovery and ownership checks. It deletes only its own fixture IDs and storage objects.
- `npm run test:e2e -w @hiveflow/web`: Chromium smoke test passed against Docker's Nginx frontend. It creates a Space through the UI, edits Text, connects ports by dragging, clicks Run all, waits for a loaded generated image, repeats for Cache hit, edits Text for Stale, then forces and cancels a batch. The UI-created Space is removed afterward.

New unit coverage includes canonical effective input hashes, batch level barriers, transitive skip behavior, independent branches, canceled coordinator state, cache ownership/asset checks, active run deduplication, cached queue bypass, force bypass, Space capacity, stale propagation after failed upstream runs, unavailable input assets, prepared snapshot ordering and a shared per-user quota across handlers/IP addresses returning 429. Existing graph tests cover topological levels and cycle rejection.

CI is configured to run these commands with service containers and a Vite frontend. Verification here was local; no remote CI run is claimed.

## Browser acceptance

Used **Connected image study** (Text → Generator #1 → Generator #2) through `http://localhost:5173`.

1. Run all processed three node records in order, showed waiting/generating progress, then succeeded with both image previews.
2. Repeating unchanged Run all immediately showed Cache hit on both generators and reused their images.
3. Editing upstream Text marked both generators Stale before any new image existed; the connected prompt reflected the new Text value.
4. Force rerun began a new batch. Cancel batch ended the batch and unfinished nodes as canceled while preserving prior previews.
5. Running again rebuilt the changed outputs; rerunning unchanged work reused cache. Reload preserved graph, results and batch status.

The demo Space remains available for review. The final Docker build includes the batch migration, API and web changes.

## Prototype boundaries

All six planned phases are implemented. The provider still generates mock PNGs. Single-node inputs snapshot at request time; Run all snapshots the graph and uses its own batch outputs at each level. References remain ordered and disconnected image inputs are optional. There is one active batch per Space; starting another returns that batch.

The deployment uses one API process. Shared rate-limit/event storage and distributed batch coordination are needed before adding API replicas. Real authentication/provider integration and orphan-object cleanup remain production work, as recorded in `DECISIONS.md`. Cached assets are validated through their metadata; externally deleting bucket objects without deleting metadata is outside the prototype's supported data-management flow.
