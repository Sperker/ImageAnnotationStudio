# Changelog

## v01.0 - Consolidated baseline

- Single-file, fully offline Image Annotation Studio application with German and English user interfaces.
- Three annotation tools: arrows, numbered markers and Region of Interest (ROI) cropping.
- Independent per-tool Undo/Redo histories, layer visibility and ordering, configurable global colors and inverted annotation mode.
- PNG and JPG exports at the original image resolution, with visible annotation layers and optional ROI cropping/frame.
- Three JPEG compression levels: Low, Medium (default) and High. Transparent image areas become white in JPG output.
- Project ZIP save and restore, including original image, annotations, settings and edit histories; compatible with older project ZIPs. ZIP downloads are prefixed with a local date-and-time stamp to distinguish saved revisions.
- Responsive settings dialog and consistent button styling.
- Versioned, dependency-free HTML build from the version field in `src/template.html`, with unit, smoke and browser regression tests.
- Windows `run-build-and-tests.bat` for building, testing and optional Playwright browser setup.
- MIT-licensed application code with separately documented Google Material Icons attribution and Apache-2.0 license terms.

Earlier development details remain available through the Git commit history. This changelog starts at the v01.0 consolidated baseline.
