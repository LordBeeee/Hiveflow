> Historical record: demo Mock/Custom providers and their integration scripts were removed. Use README.md for the current real-provider setup and offline test commands.

# Phase 4 verification

Verified against the Docker application on 2026-11-17.

## Automated checks

- `npm run build`: shared, API and web production build passed.
- `npm run typecheck`: all workspaces passed.
- `npm run lint`: ESLint and Prettier passed.
- `npm test`: 80 tests passed (26 API, 21 web, 33 shared).
- `node apps/api/scripts/smoke-runs.mjs`: Phase 3 execution checks and new Phase 4 dataflow checks passed against real PostgreSQL, Redis and private MinIO storage. The API container consumed presigned MinIO URLs through the mock provider.

New unit coverage checks synchronous Text resolution without queue jobs, connected prompt override, empty Text failure, upload references without queue jobs, all images from the latest succeeded generator run, Space ownership checks, ordered references, missing/orphan sources, unavailable assets, infrastructure errors, fresh provider references, local fallback, failed input snapshots before provider execution, deterministic reference content and failed signed downloads.

New integration assertions cover:

1. An unrun connected generator yields a named missing-output error.
2. Uploaded reference → first generator and Text → first generator work together.
3. Editing saved Text after starting the first generator preserves that run's original input snapshot; no Text run is created.
4. First generator → second generator supplies both output images from the latest succeeded run, even after a newer failure is inserted.
5. Provider downloads use valid signatures; no signed URL/credentials are stored in run inputs.
6. Repeating a run with the same prompt/reference bytes generates identical image hashes despite new signed URLs.
7. Disconnecting prompt with an empty local value fails clearly; entering a local prompt after disconnect succeeds.

The script removes only its own test records and storage objects.

## Browser acceptance

Created **Connected image study** with Text → Image Generator #1 → Image Generator #2.

- Purple edge and prompt badge identify Text #1. Generator #1 displays its connected text read-only.
- Green edge and reference badge identify the image input on Generator #2.
- Running #2 before #1 displays `Upstream node 'Image Generator #1' has no output` and Retry.
- Running #1 produces a mock preview from connected Text. Retrying #2 then produces its preview using #1's reference image.
- Deleting the purple edge restores the preserved local prompt and makes it editable. Undo restores the edge, connected text and badge.
- Reload preserves both connections, badges and output previews. Final browser warning/error log check was empty.

The demo Space remains available for review. API/web Docker containers run the Phase 4 build with the input snapshot migration applied.

## Scope and assumptions

Inputs snapshot the saved graph and latest available succeeded outputs when Run is requested. Later graph/upstream edits apply to the next request. Text and uploads resolve synchronously; generators must be run individually in dependency order. Disconnected references are optional. A disconnected prompt uses a local prompt or reports that none is available.

The mock hashes downloaded references into its preview colors; this is not an external image synthesis service. Signed GET URLs expire after 15 minutes and are generated only at execution time. Remote provider adapters need a storage endpoint reachable from their service.

Run-all, cache reuse, staleness indicators, cancellation and per-Space scheduling remain Phase 5.
