# Current quality report - 2026-10-10

This report refers to the **repository extraction of Image Annotation Studio v0.9.1 RC**, not to a fully certified 1.0 release.

## Verified in this environment

- **Build:** offline HTML generated from source with Node.js 22; two consecutive builds have identical SHA-256 content.
- **Unit regression:** 5 / 5 passed (HTML build, JavaScript parsing, translation parity, config bounds, import safety ordering).
- **Chromium UI regression:** 7 / 7 passed (initial state/translation, numbering and history, arrow movement and tool history, ROI crop and PNG, ZIP roundtrip and corrupted ZIP preservation, image size limit and temporary inverted mode, palette/tool settings and responsive layouts).
- **Visual baseline:** initial screen PNG screenshots at viewport widths **390, 800, 1280 px** match the earlier v0.9.1 RC *byte-for-byte* in local Chromium. The document title changed, which is not visible on the page.
- **Offline behavior:** automated Chromium tests observed no HTTP(S) requests from the application.

## Not yet verified here

- Real Firefox, Safari/macOS, Windows-managed workstation tests (CI includes a planned Chromium/Firefox/WebKit matrix).
- Accessibility testing with assistive technology.
- Independent security review and SVG asset provenance/legal review.
- Very large real-world image corpus and prolonged memory profiling.

**Note:** The browser harness renders the complete prebuilt HTML in memory via Playwright (`page.set_content`) because this execution environment blocks `file://` browser navigation. The shipping file itself is still standalone HTML and needs no web server.
