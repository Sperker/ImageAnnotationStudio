# Release checklist

- [x] Source separated into HTML, CSS, JS, JSON locales and configuration
- [x] Single-file offline build
- [x] Unit and browser regression suites available
- [x] Project ZIP format and technical design documented
- [x] Identified icon library and documented its **Apache-2.0 licensing** (Google Material Icons)
- [ ] Audit individual embedded SVG paths and any future replacements against their exact upstream sources
- [ ] Test on current Chrome/Firefox and **actual Safari/macOS**, plus managed Windows systems
- [ ] Test representative confidential-free large screenshots with users
- [ ] Review dependency and browser security advisories
- [ ] Final tag `v01.0` after release qualification

The git repository contains a versioned release-candidate baseline, not a claim that 1.0 is already certified. Users run `dist/Image Annotation Studio v01.0.html` directly.
