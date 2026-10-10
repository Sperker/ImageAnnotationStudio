# Image Annotation Studio — English

**Zero-Friction Image Annotation — Point. Number. Focus.**

## Why it exists

Clear software documentation often depends on screenshots. The problem is not taking the screenshot but showing **where** to look, **which step** a paragraph refers to, and **how a small detail fits into the whole interface**.

PowerPoint, Illustrator, Photoshop and other tools can do these jobs, but they may be expensive, too complex, or impossible to install on managed corporate computers. Even a free tool may disappear or stop supporting a future operating system. Closed-source software also limits independent inspection and long-term maintainability.

**Our idea:** a small, open-source, offline-first, single-page app that anyone can open in a browser without installing software, creating an account, or uploading images to a third party. It should be approachable even for someone with no graphic design experience.

## Three tools, one image

| Tool | Purpose | Example |
| --- | --- | --- |
| **Arrows** | Point at something | “Click this menu item” |
| **Numbering** | Connect visual markers to written steps | “Turn on the switch at **3**” |
| **Region of Interest (ROI)** | Emphasize an area while preserving context | Highlight a small icon while keeping its location within the full window understandable |

All tools share a **global color palette** that can match the documented application's primary color. The **inverted appearance** keeps annotations legible when they overlap similarly colored content. Holding Ctrl temporarily toggles Standard/Inverted.

## Getting started

1. Open [`dist/Image Annotation Studio v01.1.html`](dist/Image%20Annotation%20Studio%20v01.1.html) in a modern browser. No network is needed.
2. Drop an image into the drop zone, or select a file.
3. Choose Arrows, Numbering or ROI in the tool bar and annotate the image.
4. Reorder / show / hide drawing layers and use the active tool's Undo/Redo history.
5. Export a PNG at original image resolution, optionally cropped to the ROI.
6. Save a **project ZIP** to return to the original image, UI state and complete undo/redo histories later. Drop the ZIP into the app to resume.

**Keyboard:** Delete removes a selected object. Ctrl/Cmd+Z undoes an action in the active tool; Ctrl+Y or Ctrl/Cmd+Shift+Z redoes it.

## Design goals

- **No installation:** one HTML file, no backend, accounts or external fonts/libraries.
- **Ease of use first:** do the three common annotation tasks quickly, not everything an image editor can do.
- **Consistency:** one visual language, global colors and predictable tool-specific history.
- **Portability:** editable project ZIPs travel with their original image.
- **Maintainability:** inspectable sources, documented build, and regression tests.

## Developers

```bash
npm run build             # Node.js 20+, no npm install
npm test                  # static/build regression tests
python -m pip install -r requirements-dev.txt
python -m playwright install chromium
npm run test:e2e          # browser regression tests
```

Sources: `src/`; deliverable: `dist/`. Read the [architecture](docs/ARCHITECTURE.md), [project format](docs/PROJECT_FORMAT.md), [tests](docs/TESTING.md), and [contributing guide](CONTRIBUTING.md).

## Security, limits and status

Editing happens locally, but **offline/open source does not guarantee an absence of vulnerabilities**. Imported files must be treated as untrusted and browsers should stay updated. Current image limits: 65 MiB, maximum 16,384 pixels per side and 40 megapixels total.

**Build label:** v01.1 (from `src/template.html`). Cross-browser release certification remains pending. **License:** MIT, © 2026 Sperker.Training. UI icons are based on Google Material Icons artwork (Apache-2.0); the application code uses MIT. See [LICENSE](LICENSE), [third-party notes](docs/THIRD_PARTY.md), and the [icon license text](third_party/licenses/Apache-2.0.txt).

## Development attribution

Development used AI assistance. See [AI assistance and model attribution](docs/AI_ASSISTANCE.md).

## JPG export

An additional **Download JPG** button exports the same visible annotations as PNG, optionally cropped to the ROI. Use **Settings → Global · Colors & Export → JPEG compression** for Low, Medium (default), or High compression. JPG fills any transparent pixels with white; PNG remains lossless. See [JPEG export details](docs/JPEG_EXPORT.md).
