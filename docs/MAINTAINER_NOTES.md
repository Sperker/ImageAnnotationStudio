# Maintainer notes

## Repository map

- `src/template.html` - semantic HTML structure and build placeholders.
- `src/css/styles.css` - stylesheet, organized by interface feature and cascade order.
- `src/js/app.js` - editor state, pointer interactions, drawing, history, ZIP and PNG handling.
- `src/i18n/{en,de}.json` - user-facing strings only.
- `src/config/app.json` - defaults, color values, image limits.
- `scripts/build.mjs` - assembles a self-contained `dist/Image Annotation Studio v01.0.html`.
- `tests/` - unit, smoke and browser regression suites.

## Behavioral invariants

- **Image-space coordinates:** annotations are defined in source-image pixels; preview dimensions are not persisted.
- **History:** each tool has independent undo/redo. A drag is one logical step; a fresh edit clears that tool's redo stack.
- **Layer metadata:** arrow and number ordering, visibility, and active tool do not create annotation-history entries.
- **ROI:** the ROI selection is independent of the two drawing-layer stacking positions.
- **Import safety:** all project components must validate before replacing the current document.
- **Output:** selection handles, CSS outlines, canvas shadows, and hover highlights are editor UI and must not enter PNG output.
- **Offline contract:** the compiled app must never require external resources, accounts, or network access.

## Safely changing the app

1. Add or adjust a regression test for the intended behavior.
2. Modify `src/`, not the generated distribution file.
3. Run build, unit tests, smoke tests, and browser tests.
4. Verify the affected layout at narrow and wide viewports. Check pixel output, not just DOM CSS.
5. If changing serialization, test round-trips with undo *and* redo history from older versions.
6. Check build output for unexpanded placeholders, unwanted comments, remote requests, and accidental secrets.
7. Update `CHANGELOG.md` and docs alongside implementation changes.

## CSS guidance

Sections help locate components, but some later declarations intentionally override earlier ones. The order is part of the current rendering contract. Do not merge or reorder duplicate-looking selectors without visual regression checks across states and screen widths.

## Comment guidelines

Use JSDoc for contracts, data structures, side effects, and non-obvious failure behavior. Prefer explaining why a guard exists to narrating syntax. Describe best-effort protections as such: file limits reduce risk but cannot guarantee that every browser avoids out-of-memory failures.

## Testing limitations

Green functional scenarios are not a line/branch coverage percentage. Before a cross-browser release, run Firefox/WebKit CI and verify real Safari on macOS. Include confidential-free, realistically large documentation screenshots in manual tests.

## JPEG export invariant

The JPG button uses the same renderer and original-resolution canvas as PNG. Preserve PNG byte output when modifying the encoder path. Because JPEG has no alpha channel, render a white matte using `destination-over` after annotations and ROI are drawn. Keep JPEG quality settings independent of per-tool undo history; persist them in `state.export` with a default for older project ZIPs.
