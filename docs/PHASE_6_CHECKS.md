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

The optional edge-drop extension is recorded separately below.
