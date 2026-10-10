# Windows: build and test with one batch file

Use `run-build-and-tests.bat` from the root directory of the repository, alongside `package.json`.

## Prerequisites

- **Node.js 20 or newer** (`node` and `npm` on `PATH`) for the build and unit tests.
- **Python 3** (`python` or the Windows `py` launcher) for smoke and browser regression tests.
- **Playwright for Python and browser binaries** for the Chromium, Firefox, and WebKit test runs. These are development-only dependencies and are **not** included in the finished HTML application.

## Quick start

1. Open or extract the repository folder on Windows.
2. In a terminal in the project folder, run `run-build-and-tests.bat --setup` **once** to install Playwright and the three test browsers. This may download substantial data and requires Internet access.
3. Afterwards, **double-click `run-build-and-tests.bat`** to build and run the entire test suite. The terminal window stays open to show the final result.

On every normal invocation the batch file runs:

1. `npm run build`
2. `npm test` (Node.js unit tests)
3. Python smoke tests in **Chromium, Firefox, and WebKit**
4. Python browser regression tests in **Chromium, Firefox, and WebKit**

The generated offline application is `dist/Image Annotation Studio v01.1.html`.

## Failure behavior

- The script stops after a failed build, because browser tests cannot reliably test a missing or stale artifact.
- A failed unit or browser test does **not** prevent the remaining test suites from running.
- Missing Python/Playwright/browser dependencies are reported rather than treated as success.
- It exits with a nonzero status if any test stage fails or cannot run. If tests cannot launch because of missing browser binaries, run the optional `--setup` mode.
- **No browser or Python dependency is installed during a normal test run.** Setup happens only when you explicitly request it.

Cross-browser CI execution complements, but does not replace, a manual Safari/macOS check. Passing tests does not indicate a measured line-coverage percentage.

The repository uses `node --test` (automatic test discovery) rather than a shell glob so `npm test` also works in Windows Command Prompt.

The batch file does not hardcode a versioned output filename; the build prints the generated file path. The version is set in `src/template.html`.
