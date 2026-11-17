# Phase 2 verification — 2026-11-17

## Automated checks

- Build passed for shared, API, and web, including the clean Node 22 Docker build.
- Strict typecheck passed for all packages and shared test sources.
- 51 unit tests passed: 31 shared, 15 web, 5 API.
- New coverage includes graph document/params/version validation, unsupported versions, load-time field repair, canonical JSON serialization, resetting graph history on load, debouncing/coalescing autosave, edits/reverts during an in-flight request, retry and conflict states, and owner-scoped atomic updates.
- ESLint/Prettier and `git diff --check` passed.
- `node apps/api/scripts/smoke-spaces.mjs` passed against Docker API and PostgreSQL: CRUD, graph/viewport roundtrip, field-level 400s, orphan/type/cycle rejection, simultaneous same-version writes producing exactly one 200 and one 409, and ownership isolation. The script deletes only its generated fixtures.
- CI now applies migrations and runs this real-database smoke check after API startup.

## Browser checks against Docker

- Created `Mountain moodboard` from the list and opened its permanent Space URL.
- Edited both node text fields, connected an edge, changed zoom, waited for Saved, and refreshed. Text, edge, and viewport returned correctly.
- Opening a saved document stays Saved: canonical serialization fixed the false dirty state caused by jsonb object-key ordering.
- Opened the same Space in two tabs. Saved an edit in the first; editing the second showed Conflict and retained the second tab's text. No automatic overwrite occurred.
- Save as copy created a new Space with the conflicting text. Renaming it to `Blue hour study` and immediately returning to the list persisted the name via `flush()`.
- The header back control refuses to leave on a failed/conflicting save. A native navigation attempt while dirty stayed on the conflicting editor; the browser driver did not expose a native beforeunload dialog. The registered handler reads the controller's current dirty state, and native dialog display depends on browser settings/user activation.
- Temporarily stopped the API. Autosave showed Saving, then Save failed while preserving local text. Restarted the API, retried successfully, and refreshed to confirm the new text was durable.
- The migration runner completed again on API restart without removing existing Spaces.
- Saved list and conflict screenshots outside the repository. Temporary desktop viewport overrides were reset.
- The two browser-created examples remain in the local development database for review. All other integration fixtures were cleaned up.

## Limits and next phase

- Graph metadata is persistent; local image previews still require re-selection after reopening. Durable uploads and generated images start in Phase 3.
- Auth remains a fixed dev user; foreign-owner checks are retained and tested.
- The v1 graph migration is intentionally a no-op. Unsupported versions fail clearly; invalid loaded params are repaired per field with warnings.
- Autosave uses one in-flight write and freezes on conflict. It does not resolve/merge competing edits automatically.
- The frontend bundle is approximately 931 kB minified / 245 kB gzip because the shared package is still CommonJS. The existing dual ESM/CommonJS optimization remains future work.
- Phase 3 has not started. Docker remains the default one-group startup path.
