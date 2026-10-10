# Regression test guide

## Recommended commands

```bash
npm run build
npm test
python -m pip install -r requirements-dev.txt
python -m playwright install chromium
npm run test:e2e
# or all of the above after installing browser tests:
npm run check
```

To run against another engine after installing it:

```bash
python -m playwright install firefox webkit
STUDIO_BROWSER=firefox npm run test:e2e
STUDIO_BROWSER=webkit npm run test:e2e
```

`npm test` runs dependency-free checks for generated HTML, language parity, packaging and configuration. `npm run test:e2e` uses Playwright (development-only), launches a real browser, and exercises upload, editing, numbering, arrows, ROI, keyboard history, layer ordering/visibility, PNG output, local project ZIP roundtrip, corrupt ZIP protection and local-only operation. Tests use synthetic sample images; no customer screenshots are committed.

The CI matrix runs Chromium, Firefox and WebKit on Linux. **WebKit/Linux is not a full replacement for a manual Safari/macOS test.** Before a 1.0 public release, do a real-world smoke test on managed Windows/macOS systems and large screenshots. Browser warnings on intentionally blocked invalid uploads are expected in regression tests; unexpected console errors are not.

## Manual release checklist

1. Drop and select PNG/JPEG; reject invalid file and ZIP without losing the existing project.
2. Create/move/rotate/delete an arrow; ensure dark hover at handles.
3. Create 14 numbers, delete number 3, check automatic renumbering and undo/redo.
4. Make ROI; drag edge and corner; check highlighted border(s) and crop.
5. Change Standard/Inverted and temporarily invert using Ctrl, including releasing Ctrl outside canvas.
6. Hide and reorder layers; compare pixel output with visible UI, excluding handles and shadows.
7. Switch DE/EN; check small-screen layout, keyboard shortcuts and disabled buttons.
8. Export PNG in original resolution; save ZIP, start new project, restore ZIP including a pending Redo step.
9. Close/reload with unsaved changes and confirm warning; saved projects should not trigger it.
10. Verify no network requests, and no bundled credentials or external dependencies.

## Quick smoke test

After installing Playwright and a browser, run:

```bash
npm run test:smoke
```

The smoke suite checks startup, offline operation, image upload, tool switching, and the availability of export controls. This is a fast subset; use `npm run check` for the wider regression suite.

## Added release-risk checks (October 2026)

The automated regression suite now includes **11 browser scenarios**, plus **5 Node unit tests** and **1 smoke scenario**. Newly added checks cover:

- Keyboard activation of a layer, language-menu focus, arrow navigation and Escape.
- Layer reorder, hide, per-layer reset and Undo isolation.
- Failed ZIP imports preserving annotations, history, settings, palette and ordering.
- Image dimensions and byte-limit boundary cases; unsaved-state browser warning.

GitHub Actions executes **both smoke and regression suites** separately in Chromium, Firefox and WebKit. In this local environment, Chromium was executed; the other engines are pending a CI run.

## Coverage limitations

The suite counts scenarios, not executed lines/branches. **No numeric code-coverage percentage is currently measured.** Notably missing are comprehensive accessibility tests, multi-hour/large-image performance tests, real Safari/macOS tests, and fuzzing of project ZIPs.

## Test coverage interpretation

Counts refer to independent scenarios, not percentage of executed statements or branches. This repository does not currently report numeric code coverage; do not conflate a green CI badge with exhaustive browser, accessibility, security, or stress testing.
