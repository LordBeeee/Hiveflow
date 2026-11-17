# Phase 3 verification

Verified against the Docker application on 2026-11-17.

## Automated checks

- `npm run build`: shared, Nest API and Vite production bundles passed.
- `npm run typecheck`: all three workspaces passed, including shared tests.
- `npm run lint`: ESLint and Prettier passed.
- `npm test`: 68 tests passed (14 API, 21 web, 33 shared).
- `node apps/api/scripts/smoke-spaces.mjs`: CRUD, saved graph/viewport, field errors, cycle rejection, concurrent version conflict and ownership passed.
- `node apps/api/scripts/smoke-runs.mjs`: multipart upload with durable metadata/sha256 and streamed PNG; spoofed MIME, invalid content, SVG and oversized payload rejection; foreign-space ownership; four concurrent starts returning one run ID; immutable saved run params; two generated 1024×576 PNGs; subsequent run creates a new ID; latest/history recovery; live queued/running/succeeded events and 15-second heartbeat; database-to-queue gap repair; old running row becomes worker_lost. The script cleans up its own database fixtures and storage objects.
- Run service tests cover duplicate queue delivery, saved params and conditional success update, and timeout/abort failure. Provider tests cover deterministic image bytes, count, dimensions, XML escaping, injected failure and abort. UI store tests cover out-of-order results/snapshots and terminal states.

## Browser acceptance

Tested through the Nginx proxy at `http://localhost:5173` using the desktop layout.

1. Created **Image playground**, typed a local generator prompt, selected two images and clicked Run before waiting for autosave.
2. Immediately reloaded: the saved prompt/count returned and the node showed **Generating…**, followed by two mock PNG previews.
3. Used the generator attachment chooser to upload a PNG. The connected Image Upload node showed **320 × 240 · Saved image**.
4. Temporarily set `MOCK_FAILURE_RATE=1` and recreated API. Run displayed **Mock provider failed. Please retry.** with its Retry control.
5. Restored the original environment (`MOCK_FAILURE_RATE=0`) and recreated API. Retry produced two successful previews.
6. Reloaded again: uploaded reference and generated results remained visible. No browser warning/error logs were recorded during the final check.

The demo Space remains available for review. Only test-specific environment changes were temporary; the original `.env` was restored. Docker API/web are running the Phase 3 build.

## Scope

The provider is a deterministic mock, without an external AI call. Single nodes use saved local params; connected input resolution is Phase 4. Cache, run-all, staleness and cancellation remain Phase 5. Storage garbage collection and multi-instance SSE fanout are deferred as recorded in `DECISIONS.md`.
