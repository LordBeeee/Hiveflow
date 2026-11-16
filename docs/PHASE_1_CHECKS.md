# Phase 1 verification

## Automated checks

- Build and strict typecheck passed for shared, API, and web. Shared test sources are also typechecked.
- `npm test`: 25 tests passed (18 shared, 7 web). API still has no test cases because Phase 1 adds no backend behavior.
- Shared tests cover direct/indirect cycles, termination on an already malformed cyclic graph, topological levels, empty/disconnected graphs, orphan edges, duplicate IDs, port direction/type/cardinality, duplicate edges, input immutability, and field-level parameter fallback.
- Store tests cover selection notifications, empty operations, viewport/drag exclusion from history, one-step drag commits, delete/undo edge restoration, invalid connections, atomic reference attachment, and image count validation.
- `npm run lint` and `git diff --check`: passed.
- `docker compose up -d --build web api`: passed using clean dependency installation in the build image.

## Browser checks against Docker

- Added all three node types through the menu, edited text and generator params, selected aspect ratio/resolution, and verified count cannot exceed 4.
- Chose a generated SVG fixture through the file picker; preview rendered from its local object URL. Undo removed the preview and redo restored it.
- Connected Text to prompt, rejected Text to image input, connected generator to generator, and rejected the reverse edge with `This connection would create a cycle.`
- Connected an Image Upload output to the generator references input.
- Moved a node, then restored its original position with one Ctrl+Z and the new position with Ctrl+Shift+Z.
- Deleted a generator with an incident edge, then restored both with keyboard undo.
- Verified Delete/Backspace inside a textarea edits the field without removing its node.
- Verified Hand panning changes the viewport and graph undo preserves that viewport. Fit view updates the zoom indicator.
- Space panning is configured through React Flow's `panActivationKeyCode`. The browser driver's serialized held-key/drag actions did not directly verify this chord.
- Run displays the preview availability notice without attempting backend execution.
- No console errors were captured for the final application bundle during these checks. The earlier selection feedback loop found during browser QA was fixed by applying controlled node/edge selection changes.
- Desktop layout inspected at 1280px; the temporary browser viewport override was reset afterward. A screenshot was saved outside the repository as `phase-1-canvas.jpg`.

## Limits and next phase

- Refresh resets the graph and local previews. Persistence starts in Phase 2.
- Generation, connected input evaluation, and execution status remain in Phases 3–5.
- The existing CommonJS shared build still causes a large frontend bundle (about 874 kB minified / 227 kB gzip). Dual ESM/CommonJS exports remain a follow-up optimization before expanding the app significantly.
- Phase 2 has not started. Docker containers remain running with Phase 1.
