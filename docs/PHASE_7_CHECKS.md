> Historical record: demo Mock/Custom providers and their integration scripts were removed. Use README.md for the current real-provider setup and offline test commands.

# Phase 7 verification

Validated on 2026-11-17 against the rebuilt Docker application.

## Automated acceptance

- Production Docker build passed; API and web started with migrations applied. The asset migration extends kind/dimensions/duration/size, adds run model/provider-kind provenance, and translates old input snapshots.
- `npm run typecheck` and `npm run lint` passed.
- `npm test`: 116 passed (42 API, 30 web, 44 shared).
- All four API integration scripts passed: `smoke-spaces.mjs`, `smoke-runs.mjs`, `smoke-batches.mjs`, `smoke-models.mjs`. Existing CRUD, ownership, upload/Sharp validation, connected data flow, SSE, recovery, cache, concurrency, force and cancellation assertions remain covered. Snapshot fixture paths now use `inputs.ports`.
- Playwright: 4 passed. The new test verifies disabled unconfigured models, model-driven capability coercion, one-step Undo, generic Advanced options, successful model provenance, and readable recovery from a saved unknown model. All three previous browser checks also passed.
- Fake-node tests inject a cloned registry into graph/run schemas, input resolution and FE stale calculation without production changes to those mechanisms. Tests enforce output-port naming and fixed execution-hash vectors.
- Model tests cover default changes, aliases, availability, unknown/removed rejection and option/capability validation. Retry tests cover backoff/Retry-After, nonretryable errors, cancellation and accepted-task guards. Claim tests cover provider capacity blocking. Media tests cover signatures, spoofing, bounded streams and audio/video metadata/extensions with mocked object storage.
- Quoted `image_generator` production occurrences are confined to the shared registry and its executor; UI presentation uses the registry constant. No new dependencies or external provider calls.

## Default-change acceptance in Docker

Created the demo **Platform model study** and ran the same Auto image node with an unchanged prompt/settings:

| Default              | Run hash                                                           | Cache |
| -------------------- | ------------------------------------------------------------------ | ----- |
| `mock-image`         | `968ad2cc498ef0300bd687eb9d9dd9df0d4408ab317c027806f695ca15eb9f38` | false |
| `mock-image-compact` | `22b1f14b0b7598258f83ba5197047b8a9f3a59eaa38eae9b3629c282848f6032` | false |

Temporarily changed `DEFAULT_IMAGE_MODEL` and recreated API. Reloading the UI showed **Auto · Mock Image Compact**, **Stale · inputs changed**, and then **Generated with mock-image-compact** after Run. PostgreSQL confirmed both succeeded records, different hashes and no cache hits. Restored the exact original `.env`, removed the temporary backup and recreated API again.

The demo now explicitly selects Mock Image Compact, preserving its successful result without stale status. Advanced shows quality, seed and soft-light controls. The header showed Saved; browser warning/error logs were empty. Desktop 1440×900 layout was checked, a screenshot saved outside the repository, and the temporary viewport override reset.

## Scope and assumptions

The default provider remains a mock. Audio/video persistence supports bounded buffering and container signatures, not full codec validation. LLM/TTS/video catalog registrations reserve provider contracts; their executable nodes, media controls, multipart/Range work and real-provider cost guards remain Phases 8–11. Ordinary Nest provider registration is still required when adding an executor; no node-specific resolver/hash/schema/output edits are needed. Prior hashes miss once after the upgrade. See DECISIONS.md for details.
