# Phase 8 verification

Validated on 2026-11-17 against the production Docker build.

## Automated acceptance

- Docker production build passed. API/web are healthy and run the Assistant implementation; PostgreSQL, Redis and MinIO remain available. No new migration, dependency or environment variable was needed.
- `npm run typecheck` and `npm run lint` passed.
- `npm test`: 126 passed (48 API, 32 web, 46 shared).
- All five integration scripts passed: Spaces, Runs, Batches, Models and the new `smoke-assistant.mjs`. CI now includes the Assistant script.
- Assistant integration verifies two ordered Text contexts followed by the local message, prompt-improver output feeding Image Generator in the same batch, model provenance, dependency barriers, cache reuse and Force rerun. It also verifies signed image consumption by the vision mock, rejection by the text-only model, no signed URL persisted, rejection above the context cap, and cancellation while Assistant is running with no late output.
- Shared tests cover the local-message limit, valid presets with model-agnostic saves, preset execution-version cache invalidation and unchanged image hashes. FE tests confirm shared version/hash agreement and stale propagation through Text → Assistant → Image Generator.
- Executor/provider tests verify system/message construction, reference signing, empty/oversized input rejection, nonvision failure before signing/calling the provider, output cap, empty output rejection, deterministic preset-aware mock behavior, injected failures and cancellation.
- Playwright: all 5 passed. The new Assistant check searches `assist`, sees the New marker, inserts the node, selects a preset, executes the chain, checks the generated image and connected prompt, copies the complete result, reuses cache, observes both downstream stale badges, cancels a batch and reloads with the prior successful text retained. Existing model, picker, edge-drop and workflow checks also pass. Picker counts/order assertions now include the new Assistant entry.
- Browser testing found and fixed a general output recovery issue after canceled runs: successful-history recovery now restores the display output while respecting sequence/terminal-state guards. A regression unit test covers recovered text and rejection of stale/late replacements. Clipboard comparison normalizes Windows CRLF.

## Visual acceptance

Created **Assistant prompt studio** with Text → Assistant (Prompt improver) → Image Generator. Run all completed 3/3. Assistant displayed the improved text and `Generated with mock-llm`; the Image Generator showed the same connected text and its generated mock image. Copy displayed Copied; repeating Run all displayed Cache hit on both generating nodes. Reload recovered output. The header showed Saved and browser warning/error logs were empty.

Checked the desktop layout at 1440×900, saved a screenshot outside the repository and reset the temporary viewport override. The demo Space remains available for review at `/spaces/4ea5a808-2966-41d9-9610-578dc213f43e`.

## Assumptions and remaining scope

Assistant uses the deterministic local mock provider with a short abortable delay. Vision fingerprints image content and does not analyze image meaning. Total context includes two-newline separators and is rejected above 20,000 UTF-16 code units; output is capped at 20,000. Preset changes require bumping ASSISTANT_PRESETS_VERSION. Completed LLM responses are intentionally cached; Force rerun requests another completion. No token streaming in v1. Voiceover, video and real-provider cost guards remain Phases 9–11. See DECISIONS.md for details.
