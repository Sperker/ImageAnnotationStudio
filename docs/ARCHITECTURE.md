# Technical architecture

## Source and distribution

```
src/template.html      → semantic HTML skeleton
src/css/styles.css     → all CSS, including preview-only canvas shadow
src/js/app.js          → existing editor / rendering / import / export logic
src/i18n/de.json       → German UI texts
src/i18n/en.json       → English UI texts
src/config/app.json    → numeric defaults, palette, image/canvas limits
scripts/build.mjs      → builds dist/Image Annotation Studio v01.1.html
```

`npm run build` is dependency-free and deterministic: inject JSON literals and local CSS/JS into the HTML template. The resulting file works using `file://`, without HTTP requests, a server or any runtime packages. There is no template engine or framework. This is a **low-risk structural extraction** of the v0.9.1 release candidate, not a rewrite of the annotation engine.

## Editing model

- `state.img` and `state.sourceFile` reference the original decoded image and original uploaded bytes.
- All annotations are stored in **original-image pixel coordinates**, independent of preview resolution.
- `state.items.arrows`, `.numbering`, `.roi` hold each tool's data. The ROI is a separate crop/highlight tool; `state.front` orders the two drawing layers.
- `state.visible` controls display/export without deleting a layer.
- `state.active` selects the editable tool; only this tool's Undo/Redo history is active.
- `state.hist[tool].undo/redo` hold snapshots of that tool's items/settings (currently at most 100 undo states). Layer visibility and ordering do not enter these histories.
- `state.palette` defines global annotation colors. `state.settings` holds tool-specific dimensions and drawing options.
- Preview uses a scaled canvas; PNG export calls the renderer again at **original resolution**. Canvas CSS shadows, handles, tool overlays and hover outlines do not appear in the bitmap.

## Rendering and ROI

The view window is either the complete image or a valid ROI. Pointer positions are transformed from CSS pixels through the preview transform into original coordinates. Numbering is sequentially renumbered after deletion. Arrow corner handles rotate the arrow. Dragging the ROI edge highlights that edge; dragging a corner highlights both adjacent edges. The ROI can crop exports independently of drawing layer order.

## Save/restore and trust boundaries

Image Studio project files contain `project.json` plus the original image. The app validates ZIP/CRC, JSON fields, numeric values, history shape, declared dimensions and decodability **before** replacing the current project. The format version in JSON is `1`; see [PROJECT_FORMAT.md](PROJECT_FORMAT.md). This is a constrained ZIP implementation (uncompressed/STORE), not a general-purpose unzipper.

The application processes potentially sensitive screenshots locally. HTML, JavaScript and images are not uploaded by the app. Security still depends on a maintained browser, this code, and the content users import. Do not claim the app is “vulnerability-free.”

## Current limits / Grenzen

- Image file: **≤65 MiB**.
- Image dimensions: **≤16,384 pixels per side** and **≤40 megapixels total**.
- PNG export: **≤40 megapixels**, subject to browser memory limits.
- Preview is additionally scaled for memory safety.
- Import ZIP: **≤90 MiB** and exactly two entries, using uncompressed ZIP/STORE.
- Editable ZIP project JSON: **≤12 MiB**.
- History: **up to 100 undo snapshots per tool**.

## Design of the repository

A single `app.js` is kept intentionally for this first source extraction. Splitting it into more modules without accompanying tests would increase the risk of breaking application behavior. Future work can extract pure logic (project validation/ZIP, renderer, history) as smaller modules **only after adding regression coverage**. Build and unit tests need only Node.js; Playwright browser tests are a development-only dependency.
