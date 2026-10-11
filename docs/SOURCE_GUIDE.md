# Source code guide - Image Annotation Studio v01.0

The code documentation follows two reference conventions: detailed JSDoc
(`@file`, `@description`, `@param`, `@returns`, `@throws` and `@typedef`) from
`5_visualizations.js`, and the numbered table of contents / large section
headers from `style(1).css`. Documentation and code comments are in English.

## Table of contents

1. Source map and reading order
2. Browser application and state
3. Drawing and image operations
4. Archive import and export
5. HTML template and CSS cascade
6. Build script and configuration
7. Test suite and offline constraints
8. Language startup and project restoration

## 1. Source map and reading order

| File | Role | Documentation |
| --- | --- | --- |
| `src/js/app.js` | All editor behavior, pixels, UI state, annotations, ZIP handling | File overview, 10 numbered sections, JSDoc for all top-level functions, types and field schema |
| `src/css/styles.css` | Ordered visual rules and responsive layout | 13-section table of contents and matching large headings; later rules override earlier declarations |
| `src/template.html` | Static accessible controls and injection markers | HTML comment overview and numbered functional sections |
| `scripts/build.mjs` | Deterministic source-to-single-HTML compiler | JSDoc helper contracts and numbered processing phases |
| `run-build-and-tests.bat` | Windows build and test launcher | REM overview, help and phase annotations |
| `tests/unit/build.test.mjs` | Build invariants and structural checks | JSDoc and named test responsibilities |
| `tests/smoke/test_smoke.py` | Initial browser workflow | Module and test docstrings |
| `tests/e2e/test_studio.py` | End-to-end behavior and edge cases | Module, helper, fixture and test docstrings |
| `src/config/app.json` | Immutable build-time defaults and safety limits | Described below without inserting illegal JSON comments |
| `src/i18n/en.json`, `de.json` | Parallel localized UI dictionaries | Described below without inserting illegal JSON comments |

## 2. Browser application and state

The `state` object in `src/js/app.js` is the current browser session's editor
state. Arrows, numbered circles and ROI have independent undo/redo stacks and
annotation settings. Persistent positions use intrinsic image pixel
coordinates. Layer visibility, drawing order and the viewport are UI state,
not annotation geometry. The currently selected language is stored in
`state.lang` and copied into the project manifest upon ZIP export.

## 3. Drawing and image operations

`prepareImage` validates the source file before the editor is changed.
`commitImage` installs it and resets the tool histories. `pointerPos` maps DOM
pointer coordinates to image pixels, including ROI-only previews. `render`
is reused for preview and export. Only `selectionDraw` adds editor-only
handles. `exportImage` selects PNG or JPEG; for JPEG the canvas uses a white
background and the quality setting in `src/config/app.json`. The original
image is supplied by the user: there is no bundled static image asset.

## 4. Archive import and export

`projectSnapshot` creates a manifest containing original-image metadata,
annotations, histories, visibility, language and JPEG compression. `createZip`
writes uncompressed ZIP entries without dependencies. During import,
`readZip`, `validateProject` and `prepareImage` run **before** `commitImage`.
This prevents malformed archives from destroying the already open project.
Archives created by earlier versions without JPEG compression selection
continue using the Medium default.

## 5. HTML template and CSS cascade

`src/template.html` is the source of the version number via
`<meta name="studio-version" content="01.0">`. Its `BUILD:CSS`, `BUILD:JS`
and `BUILD:VERSION` markers are replaced during compilation. Its initial
`lang="en"` and English static text are consistent with browser startup.
CSS sections are intentionally ordered, not alphabetized: the final sections
make product-design overrides to earlier base rules.

## 6. Build script and configuration

Run `npm run build` (Node.js >= 20) to generate
`dist/Image Annotation Studio v01.0.html`. All code, CSS, configuration and
language dictionaries are inlined; no network access is needed when opening
the result. `scripts/build.mjs` strips developer JSDoc, stylesheet comments and
template-only HTML comments from the output, preserving rich source documentation without bloating the release.

`src/config/app.json` is strict JSON:

- `limits` sets encoded file, original pixel, preview and export safety caps.
- `defaults` provides the numerical configuration for arrows, numbering and ROI.
- `palette` provides Standard/Inverted colors, handle colors and ROI overlay.
- `jpeg.quality` maps low/medium/high **compression** to encoder quality.
- `jpeg.defaultCompression` is `medium` for new or legacy projects.

`src/i18n/en.json` and `src/i18n/de.json` use identical keys. They define
user-visible text only; the build rejects mismatched keys. The initial HTML
has readable English fallbacks until `refreshLanguage` runs.

## 7. Test suite and offline constraints

`npm test` covers build and locale invariants; `npm run test:smoke` exercises
basic upload/layer/export flows; `npm run test:e2e` covers project persistence,
editing, JPEG and PNG export, and responsive layout. Browser tests use
`STUDIO_BROWSER=chromium|firefox|webkit`, defaulting to Chromium. Build first.
The regression fixture rejects external HTTP(S) requests and browser script
errors, keeping the single-file deliverable truly offline.

## 8. Language startup and project restoration

Fresh launch: English (`en`) in the HTML root, language menu, static fallback
text and browser `state.lang`. The user may switch to German (`de`). On import,
the language recorded in the project ZIP wins over the startup default.
The New Project action preserves the user's current language selection.
The application version remains v01.0.
