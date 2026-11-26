> Historical record: demo Mock/Custom providers and their integration scripts were removed. Use README.md for the current real-provider setup and offline test commands.

# Phase 10 verification

Validated on 2026-11-17 against the rebuilt Docker application.

## Automated acceptance

- Production Docker build passed and the video-task migration applied. API/web run healthy with the committed MP4 fixture. Runtime has no ffmpeg-static package or ffmpeg binary requirement.
- `npm run typecheck` and `npm run lint` passed.
- `npm test`: 147 passed (65 API, 33 web, 49 shared).
- All seven API integration scripts passed: Spaces, Runs, Batches, Models, Assistant, Voiceover and Video. Existing CRUD, ownership, uploads, data flow, SSE, cache, force, cancellation and recovery coverage passed after the shared infrastructure changes.
- Video integration verifies Text → Assistant → Video Generator with an uploaded start image, moving progress, accepted task IDs, model/provider provenance, streamed MP4 sha256 and metadata, Content-Type/Disposition, private caching, 206 bounded/open/suffix ranges, 416 unsatisfiable ranges, ETag/If-Range and cache reuse. Unsupported duration/end-image fail before a provider task is created; active cancellation marks the remote mock task canceled.
- A generated 6,291,488-byte storage stream exercises actual MinIO multipart upload: the object's ETag confirms two parts, content hash and byte length match, and a Range crossing the 5 MB boundary returns the expected bytes. An interrupted stream leaves no incomplete multipart upload. This synthetic storage fixture tests signatures/transport, not codec validity; the committed MP4 is the playable fixture.
- With VIDEO_RESTART_API=1, the script SIGKILLs the Compose API after task acceptance, starts it, waits for the same run to succeed and confirms the original task ID and submit_calls=1. The original deadline is retained. Startup recovery does not resubmit the accepted task or mark it worker_lost.
- Six queued/concurrent video requests leave the fast image worker queue available: two video jobs run under the video/provider limits and an image finishes in under 12 seconds while no video has completed. Remaining video requests are canceled and fixtures cleaned up.
- Unit coverage includes Range edge cases, per-kind timeout configuration/recovery bounds, video parameter coercion, capability rejection, checkpoint-before-poll, resume without submit/reference signing, poll failure/cancellation, safe transient poll retry, streaming signature/size/hash checks, startup recovery, progress change emission without poll writes, and FE progress retention across history snapshots.
- Playwright: all 7 passed. The new test runs Text → Assistant → Image Generator / Voiceover / Video Generator, checks all four output types, observes moving progress, plays/seeks the 2-second MP4, verifies Range through the frontend proxy, reuses four caches, propagates stale to all four generating nodes, cancels and refreshes prior output. It also tests model coercion/Undo, disabled unsupported options, conditional audio toggle, and the end-image port warning with Run blocked. Final targeted video checks were rerun after the last HTTP/UI changes.

## Visual acceptance

Created **Video motion studio** at `/spaces/5ff4c404-77dc-4292-8998-c2454186210f`, connecting Text → Assistant (Prompt improver) → Video Generator plus Image Upload → start_image. Run all completed 4/4. The video node showed the connected prompt/reference, model settings and the mock fixture. Clicking Play advanced currentTime to about 0.41 s with no media error; seeking with the native scrubber moved it to about 1.38 s of a 2 s clip. Repeating Run all displayed Cache hit on Assistant and Video Generator.

The header showed Saved and browser warning/error logs were empty. Checked the desktop layout at 1440×900, fitted the completed nodes, saved a screenshot outside the repository and reset the temporary viewport override. The demo remains for review.

## Decisions and remaining scope

The mock takes roughly 18–24 seconds plus polling/storage and returns the same 33,249-byte, 2-second, 320×180 silent H.264 fixture despite requested generation settings. UI labels this limitation. Per-run request IDs provide mock submit idempotency; real adapters must honor them. Video polling occupies a dedicated worker slot; delayed-job polling is deferred. The deployment remains one API replica.

Audio/video use immutable private one-hour caching and content-hash ETags; images retain no-store. Multipart uses two 5 MB parts with a configured maximum size and cleanup on handled failure. Orphan objects/incomplete parts after hard termination remain production lifecycle work. The PostgreSQL UPDATE RETURNING tuple issue was fixed with writable CTE SELECT results, also restoring prompt abort/remote cancellation for existing node kinds. Local legacy recovery timeout was raised to 930000 to accommodate 15-minute video jobs. ffmpeg ran successfully to generate the fixture; Docker/CI skip downloading the development generator binary. Paid providers and cost guards remain Phase 11; no Phase 11 work was started. See DECISIONS.md for details.
