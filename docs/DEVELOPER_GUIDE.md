# Developer guide

## Getting started

- `src/template.html`: HTML skeleton and build markers.
- `src/css/styles.css`: readable stylesheet, divided into base rules, component areas, responsive rules and deliberately ordered overrides.
- `src/js/app.js`: JavaScript logic with JSDoc for named functions, domain concepts and arguments.
- `src/i18n/de.json` and `en.json`: UI translations.
- `src/config/app.json`: limits, defaults and theme palette.
- `scripts/build.mjs`: dependency-free offline bundler.
- `tests/`: unit, smoke and end-to-end regression checks.

## Important invariants

1. Annotation coordinates are always stored in original image pixels.
2. `arrows`, `numbering` and `roi` have **independent** undo/redo histories.
3. Layer ordering/visibility does not belong to annotation undo history.
4. Project import is validated before changing the active document.
5. The distributed HTML must not load remote code, styles, fonts or assets.

## Build and verification

```sh
npm run build
npm test
npm run test:smoke
npm run test:e2e
```

Comments in `src/` are for developers. JSDoc blocks in JavaScript and CSS block comments are removed from the bundled `dist/Image Annotation Studio v01.0.html`. The build does not minify or otherwise transform the program logic.

### About the CSS cascade

Several later rules intentionally override initial component defaults. They remain in source order to preserve pixel-level behavior. For large refactors, prefer first adding a visual regression test for the relevant screen width and state.

### JSDoc conventions

Named functions carry a short description and parameter annotations; core application data types are described near the beginning of `src/js/app.js`. Event listeners and inline callbacks remain adjacent to their related features.


## Build version and output filename

Change only the value of `<meta name="studio-version" content="01.0">` in `src/template.html` to version the standalone HTML build. `scripts/build.mjs` reads and validates that field, inserts it into the generated HTML `<title>`, and writes `dist/Image Annotation Studio v<version>.html`. The source template is authoritative; do not hardcode the release filename in tests or batch scripts.

The `package.json` version follows npm's semantic-version format for repository metadata and is not used to name the HTML artifact. Release managers should update it when preparing a new published project release.
