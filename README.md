# Image Annotation Studio

**Zero-Friction Image Annotation - Point. Number. Focus.**

**[User guide](README.en.md) · [Developer guide](docs/DEVELOPER_GUIDE.md) · [Planned changes](docs/TODO.md) · [Contributing](CONTRIBUTING.md)**

Image Annotation Studio is a small, open-source, offline-first tool for turning screenshots into clear documentation. **No installation, account, server or upload to a third party is required**: open the self-contained HTML file in your browser.

[Download the standalone application](dist/Image%20Annotation%20Studio%20v01.0.html) · [Why this exists](docs/VISION.md) · [Technical documentation](docs/ARCHITECTURE.md) · [JPEG export details](docs/JPEG_EXPORT.md) · [Regression tests](docs/TESTING.md) · [Maintainer notes](docs/MAINTAINER_NOTES.md)

## The three tools

1. **Arrow annotation** - point at a relevant UI element.
2. **Number annotation** - link numbered markers in a screenshot to steps in a document.
3. **Region of Interest (ROI)** - highlight a detail while keeping its surrounding visual context.

Consistent global colors and a temporary *inverted* mode keep the annotations visible even on top of a product's primary color. Layer visibility and ordering, per-tool Undo/Redo, original-resolution PNG and JPG export (three JPEG compression levels), and re-editable project ZIPs are built in. Project ZIP download names automatically include the local date and time (to the second), followed by the original image name.

## Run / build / test

- **Use:** open `dist/Image Annotation Studio v01.0.html` - even without Internet.
- **Build:** install Node.js 20+ and run `npm run build` (no npm install necessary).
- **Unit tests:** `npm test` (no third-party packages).
- **Browser tests:** `python -m pip install -r requirements-dev.txt`, `python -m playwright install chromium`, then `npm run test:e2e`.
- **Everything:** `npm run check`.

The build combines `src/template.html`, `src/css/styles.css`, `src/js/app.js`, `src/i18n/*.json`, and `src/config/app.json` into **one HTML file**. Browsers do not need Node.js or Python. The build does not connect to the Internet.

## Publication status

Build version: **v01.0**, configured in `src/template.html` (the single source for the output filename and HTML title). The filename version does not imply completed multi-browser certification; complete the release checklist before public release. See [release checklist](docs/RELEASE.md).

## License and security

The application code is licensed under **MIT**, © 2026 Sperker.Training. UI icons use **Google Material Icons** artwork under the separate **Apache License 2.0**; see [LICENSE](LICENSE), [third-party attribution](docs/THIRD_PARTY.md), and the [Apache-2.0 license text](third_party/licenses/Apache-2.0.txt). Individual SVG provenance should still be checked when icons are added or replaced.

The application performs editing locally by design; **offline and open source do not mean vulnerability-free**. Imported image/project files are untrusted. See [security notes](SECURITY.md). **Never include confidential screenshots or project ZIPs in public bug reports.**

## Development attribution

This project was built with AI-assisted development. See [AI assistance and model attribution](docs/AI_ASSISTANCE.md) for the maintainer-provided list and its limitations.

## Windows one-click build and tests

Run `run-build-and-tests.bat` from the repository root. For a first-time test setup, use `run-build-and-tests.bat --setup` in a terminal; this installs Playwright and browser engines (requires Internet). See [the Windows test guide](docs/WINDOWS_BUILD_AND_TESTS.md).

### Source documentation

Detailed function contracts, code navigation and an explanation of the build and test source files are available in [docs/SOURCE_GUIDE.md](docs/SOURCE_GUIDE.md). The program starts in English; German remains selectable, and imported projects restore their saved language.
