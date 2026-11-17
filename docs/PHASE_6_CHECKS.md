# Phase 6 verification

## Baseline node picker

- Shared registry metadata supplies the catalog's node labels, categories, descriptions and keywords. Only Image and Text category chips appear; no placeholder nodes are listed.
- The old add-menu markup and CSS were removed. A modal picker includes search, category chips, ranked list rows and keyboard hints, using the existing dark theme and accent colors.
- N/plus opens with search focused; arrows wrap through active options, Enter/click inserts, hover selects, Escape/backdrop/close dismisses and returns focus to plus. Tab/Shift+Tab stays inside the picker. Editable fields and modified N shortcuts retain native behavior.
- Insertion preserves existing flow-coordinate placement/offset and records one graph history step.
- Pure ranking tests cover ranking precedence, stable ties, case/diacritics/Vietnamese đ, category/search combination, empty and unmatched queries, and catalog metadata consistency.

Baseline validated on 2026-11-17:

- Production build passed inside Docker; API/web restarted healthy.
- `npm run typecheck` and `npm run lint` passed.
- `npm test`: 99 tests passed (36 API, 28 web, 35 shared).
- `npm run test:e2e -w @hiveflow/web`: picker keyboard/focus test and existing workflow execution test passed against Docker. The picker check creates and deletes its own Space and verifies N → tex → Enter → Ctrl+Z, native typing, combined filters, absent categories, arrow wrapping, Tab containment and Escape focus restoration.

## Edge-drop extension (separate commit)

- Dropping a source or target connection on empty canvas opens a compatible-only picker near the drop point. Filtering and final insertion both use the shared connection validator, including type checks and occupied single-input rejection.
- The chosen node uses the exact flow-coordinate drop point. Node plus edge is one graph mutation and one Undo/Redo step. Dismissing the compatible picker restores focus and reopening with N/plus restores the complete catalog.
- Shared tests cover forward/reverse direction, first compatible port, mismatched types, removed sources, occupied inputs and duplicate IDs. Store tests cover drop position, atomic undo/redo and a failed second insertion without history changes.
- Final `npm test`: 103 tests passed (36 API, 29 web, 38 shared). Production Docker build, typecheck, lint and diff whitespace checks passed.
- Final Playwright suite: 3 passed. The new edge-drop test drags a generator's prompt input onto empty canvas, verifies that only Text is offered, clicks it, checks the node position and edge, then verifies one Ctrl+Z removes both. The existing keyboard picker and workflow execution tests also passed.

## Visual acceptance

Created **Node picker playground** in the Docker UI. N opened the themed picker with focused search; typing tex and pressing Enter inserted Text #2, and Ctrl+Z removed it. Dragging Text #1's output onto the blank canvas offered only Image Generator. Esc followed by N restored all three entries and both populated category chips. Final close returned focus to Add node; the header showed Saved and browser warning/error logs were empty.

The demo Space remains available for review. Docker API/web run the Phase 6 build. No nodes from Phases 8–10 or platform changes from Phase 7 were introduced beyond the registry metadata explicitly needed for this picker. No new dependencies were added.
