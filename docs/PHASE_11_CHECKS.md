# Phase 11 verification

Verified locally on 2026-11-18. **11.1 is implemented; 11.2 is pending required inputs.** All executable providers remain mocks.

## Automated checks

- Typecheck passed for API, web and shared. Production Docker API/web builds passed and both usage migrations applied successfully. No dependency was added.
- Unit tests: 154 passed (69 API, 33 web, 52 shared), including cost formulas, exact/bounded TTS estimates, model freezing, cache failure propagation, admission limits, zero-limit configuration and execution-content approval hashes.
- All existing API smoke suites passed: Spaces, Runs, Models, Batches, Assistant, Voiceover and Video. The batch recovery fixture now creates its reservation and ledger atomically, matching real admission. Fixture cleanup removes only its own ledger entries.
- `node apps/api/scripts/smoke-costs.mjs` passed against PostgreSQL/Redis/MinIO: mixed static-known graph quote equals ledger at 15.01 credits; four cache hits cost zero; Force rerun restores the provider quote. Unknown Assistant → TTS reserves 6 credits and settles downward to actual text length. Approval rejects changed content or tighter caps, while viewport changes preserve approval. Both provider-node and credit limits return 422 with no partial admission. Failure and active-work deletion refund once; completed usage survives workflow deletion. Concurrent 0.75-credit reservations under a one-credit daily limit admit only one. Refunds remain on their original budget day and are idempotent; increased execution cost cannot exceed the reservation.
- Playwright: all 8 passed. New cost tests verify the single-node tooltip, confirmation before any job exists, free dismissal, successful confirmation, zero-cost cached quote and disabled confirmation for an over-limit graph. Existing Assistant, Voiceover, Video, model, picker and Run all checks pass with the review step, including playback/seek/Range, cache, stale and cancel.
- Fixed browser helper synchronization: wait for confirmation dialog closure before editing or inspecting a previous completed batch. Fixed approval after Fit view by hashing execution content instead of camera version changes. Fixed Nginx stale API container addresses using Docker DNS resolution; verified through the browser suites after recreation.

## Visual acceptance

Created **Cost guard playground** at `/spaces/4bd0bdf8-9879-413c-a20c-aeaa098479bd`. Initial Run all showed one provider node / one estimated credit. Cancel returned to the untouched workflow. Confirming the next quote completed 2/2, displayed a generated mock image and changed the node's tooltip to zero cached credits. Reopening Run all showed zero provider nodes, zero estimated credits and one cached node; Force rerun showed one credit again. Saved a screenshot outside the repository, then canceled the review and unchecked Force rerun. The demo remains for review. No paid provider calls were made.

## Accounting and remaining scope

Rates are illustrative abstract credits. Unknown upstream results produce conservative upper bounds rather than speculative cache hits; unused credit is released during execution. Quotas use atomic per-user reservations, UTC admission dates, numeric milli-credit amounts and idempotent refunds/reconciliation. Completed ledger audit IDs survive Space deletion. Historical pre-upgrade mock runs retain zero cost. The prototype remains single API replica, with real authentication and orphan-object cleanup deferred.

Phase 11.2 needs paths to the user's existing `KlingService` and Seedance client, plus the chosen LLM and TTS providers. These were requested before starting adapters, as required by NODES_PLAN.md: “Ask the user to provide those files before starting this step.” Without those sources/provider choices, recorded adapter contracts and user-run live checks cannot be implemented honestly. No adapter was guessed from vendor docs; no whole-Phase-11 completion is claimed.
