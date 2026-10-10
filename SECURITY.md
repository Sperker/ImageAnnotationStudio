# Security policy

Image Annotation Studio aims to work entirely offline, without uploading user images or project files. This is an architectural property, **not a guarantee that the software is free from security flaws**.

- Keep your browser updated and use software within organizational policy.
- Treat imported images and project ZIPs as untrusted; report validation bypasses, crashes and suspicious file behavior privately.
- Do not include real client/employee screenshots, tokens, paths, or confidential image data in public bug reports.
- Before publishing a vulnerability, contact the maintainer through an appropriate private channel listed on the eventual repository. A public vulnerability contact is **not yet configured**.
- No server-side processing or telemetry is included in the current build.

Release qualification includes imported file fuzzing and testing in modern browsers; see `docs/TESTING.md`.
