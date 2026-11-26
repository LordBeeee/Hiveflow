> Historical record: demo Mock/Custom providers and their integration scripts were removed. Use README.md for the current real-provider setup and offline test commands.

# Phase 9 verification

Validated on 2026-11-17 against the Docker application.

## Automated acceptance

- Production Docker build passed; API/web run the Voiceover implementation. No new dependency, database migration or environment variable was added.
- `npm run typecheck` and `npm run lint` passed.
- `npm test`: 134 passed (54 API, 32 web, 48 shared).
- All six API integration scripts passed: Spaces, Runs, Batches, Models, Assistant and the new `smoke-voiceover.mjs`. CI now includes Voiceover.
- Voiceover integration verifies Text → Assistant (script_writer) → Voiceover in Run all with dependency barriers, resolved model/provider-kind provenance and ordered immutable script input. It verifies audio asset metadata, nullable dimensions, duration, valid PCM WAV headers, byte length, audio/wav Content-Type and .wav Content-Disposition. Cache reuses the asset; Force rerun creates a new one. It also checks direct Text input, empty/oversized connected input, local fallback on disconnect, unsupported voice/language and cancellation during active TTS with no late output.
- Provider tests verify deterministic 16-bit PCM mono at 16 kHz, nonzero soft samples, RIFF/data sizes, different scripts producing different bytes, speed scaling, five-minute cap, cancellation during sample generation and MOCK_FAILURE_RATE. The maximum WAV is 9,600,044 bytes. Caching Math functions outside the sample loop made the full five-minute cap test complete within the standard timeout.
- Executor tests verify connected/local script behavior, correct provider settings, audio persistence with MIME/duration, input/capability rejection before provider calls and discarded canceled completions. Shared tests verify local-script limits, 0.05 speed steps, model-agnostic saves and atomic voice/language/speed/options coercion.
- Playwright: all 6 passed. Voiceover's new test covers Audio picker/search, model availability, model-dependent choices, atomic coercion and Undo, script-writer batch execution, disabled connected script with matching content, actual browser audio playback (duration/readiness/currentTime), cache, downstream stale propagation, cancel, refreshed previous audio and local-script recovery on disconnect. All previous Assistant/model/picker/workflow tests passed; category/order expectations now include Audio/Voiceover.

## Scope and assumptions

The mock returns soft deterministic tones, not spoken narration, and the UI labels this explicitly. Duration uses whitespace word count and a 0.2-second minimum with a five-minute cap. Both local and effective connected scripts are limited to 5,000 UTF-16 code units. WAV playback uses full-body responses; Range/multipart streaming remains Phase 10. Real TTS providers remain Phase 11 cost guards. Video is still only a catalog contract. See DECISIONS.md for details.

## Final Docker and visual acceptance

After optimizing sample generation, rebuilt API/web and reran the Voiceover integration plus its Playwright test successfully against that final build.

Created **Voiceover narration studio** with Text → Assistant (Script writer) → Voiceover. Run all completed 3/3; the connected script matched Assistant output, voice/language/speed controls showed calm/English/1.00×, and the player loaded the generated WAV with a duration and Download audio link. Clicking Play advanced playback; Pause restored the Play control. Repeating Run all showed Cache hit on Assistant and Voiceover while retaining the same audio. The UI explicitly displayed Mock tone preview · not spoken narration. The header showed Saved and browser warning/error logs were empty.

Checked the desktop layout at 1440×900, saved a screenshot outside the repository and reset the temporary viewport override. The demo remains at `/spaces/be835459-37d2-4c25-8fef-1ac05ec49beb`. Phase 10 was not started.
