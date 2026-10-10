# Changelog

## 0.9.1 — Repository edition (unreleased)
- Source extracted into maintainable HTML/CSS/JS, localization JSON and configuration JSON.
- Added dependency-free build, regression tests, and German/English/technical documentation.
- Preserved the single-file offline deliverable and existing feature behavior.

## 0.9.1 — Release candidate
- Removed Hungarian UI language; DE/EN remain, old HU projects fall back to DE.

## 0.9 — Release candidate
- Hardened project ZIP import before commit, warned on unsaved changes, guarded large image/PNG operations.

## 0.1–0.8 — Integrated studio development
- Combined arrows, numbering and ROI into a layered, independently undoable image editor.
- Added project ZIP export/import, responsive interface, SVG layer icons and original-resolution export.

- Confirmed MIT license and added a quick browser smoke-test command; documented coverage limitations.

### Tests (October 2026)
- Expanded browser regression suite from seven to eleven scenarios.
- Added per-browser CI smoke tests, invalid ZIP state-preservation, keyboard/focus, layer isolation, and image-limit checks.
- No changes to the shipped application.

### Developer documentation update
- JSDoc annotations for named functions and core state concepts.
- CSS formatted and grouped into clearly described cascade sections.
- Release build strips source-only JSDoc and CSS comments.
- Added `docs/DEVELOPER_GUIDE.md`.

### Documentation maintenance

- Standardized developer documentation in English, with German retained only for user-facing UI localization.
- Added maintainer invariants and a contributor-facing review checklist.
- Documented known limitations in functional and cross-browser coverage.
- No application behavior change intended.

- Documented maintainer-provided AI-assisted development attribution; no application behavior changes.

- Corrected the maintainer-provided attribution to GPT-3.5 instead of GPT-4o.

## Build output naming (v01.0)

- The HTML template defines the build label (`studio-version: 01.0`) and the browser tab title.
- The build produces `dist/Image Annotation Studio v01.0.html`.
- Unit, smoke, regression and Windows batch workflows resolve the output without hardcoded version names.
- No changes to the annotation engine or user interface.
