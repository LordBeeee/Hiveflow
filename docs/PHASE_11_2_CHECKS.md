# Phase 11.2 verification

11.2a groundwork: MediaInput storage bytes, bounded HTTP, SSRF-safe streaming downloads, capability contracts/UI and read-only OpenRouter discovery. No selected real catalog entries, credentials or paid calls. 11.2b OpenRouter adapters are implemented; production catalog activation remains the user-selection checkpoint. Seedance/Kling/Veo are outside this checkpoint.

Groundwork checks on 2026-11-19: 176 unit tests passed (89 API, 33 web, 54 shared); strict typecheck passed. HTTP tests cover abort/timeout, bounded binary/JSON and redaction. Download fixtures cover non-HTTPS, private IPv4/IPv6, unsafe redirects and content-length/stream caps. Media tests cover byte-based data URIs, format/dimension/size checks and base64 request overhead. Existing video resume/checkpoint tests still pass.

## OpenRouter checkpoint (2026-11-19)

- Three original OpenRouter adapters share a key-gated HTTP client; tests exercise registration with/without a key, vision gating, byte-based references, exact JSON bodies, optional image fields, strict base64/raster decoding, HTTP-200 embedded errors, voice validation, speed omission/allowlists, Google token-cap presence and PCM-to-WAV conversion. All request/response fixtures are handwritten; no provider network is used.
- Full unit run passed: 211 tests (124 API, 33 web, 54 shared). A final error-mapper check passed 14 tests including one new HTTP-status/body-code disagreement case (212 distinct passing tests across the final runs). Strict typecheck and lint passed. Host and Docker production API/web builds passed. The offline runtime probe measured the committed silent MP3 at 264 ms and verified a 1,000 ms stereo PCM/WAV sample, plus invalid MP3 rejection.
- All eight real-infrastructure smoke suites passed on the rebuilt mock stack: Spaces, Runs/dataflow, Batches, Models, Assistant, Voiceover, Video and Costs. This includes MinIO asset bytes/hash/Range, immutable input snapshots, signed-reference mock compatibility, checkpoint/resume/cancel, cache/stale, refunds, daily quota and recovery. No live provider call was made.
- All 9 Playwright browser tests passed (1.2 minutes), including the new capability fixture that disables Voiceover speed, enforces prompt/script limits, requires a video start image, hides the included-audio toggle and switches a connected video ratio to adaptive. Existing playback/seek, model coercion/Undo, picker, costs, cache/stale and cancellation workflows pass.
- CLI guards passed offline: missing key blocks discovery; missing opt-in/key blocks live-check; opted-in dummy credentials still cannot generate until all three kinds have chosen catalog entries. No keys or raw vendor errors are printed. Discovery's 19 image candidates are only a filter against the live endpoint, not claims that all IDs exist.

## Deliberate stop and remaining acceptance

No real model catalog entries, model voices or prices were fabricated. The user runs `node scripts/dump-openrouter-models.mjs` with their key exported locally, chooses IDs, then supplies only IDs. Image catalog rows still need definitive endpoint capabilities/limits/pricing; missing discovery prices print null. Google needs a documented model-specific maxOutputTokens cap before catalog activation; no text-to-audio-token formula was invented. Decisions and official documentation conflicts are recorded in `DECISIONS.md`.

The acceptance requiring chosen LLM/image/speech rows to appear available in GET /models and paid live-check success remains pending that selection and a user-run live check. Key-gated adapter registration is covered offline; mock behavior and unconfigured-provider availability are covered by unit/integration tests. Seedance/Kling and optional Veo were not started.
