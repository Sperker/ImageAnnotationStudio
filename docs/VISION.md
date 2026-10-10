# Product vision

**Zero-Friction Image Annotation - Point. Number. Focus.**

> The best annotation is one that needs no explanation.

The challenge is not capturing screenshots; it is making them intelligible in technical documentation. Readers need to know **where to look**, **which element a numbered instruction refers to**, and **where a small detail appears within its surrounding interface**.

General-purpose presentation and graphic-design software can accomplish this, but often requires installation privileges, time to learn, expensive licenses, or vendor-specific formats. Free desktop alternatives may be discontinued or become incompatible with future operating systems. Organizations may prohibit installation entirely.

Image Annotation Studio deliberately focuses on three tasks:

1. **Point:** arrows direct attention to a relevant element.
2. **Number:** numbered markers link screenshot details to written instructions.
3. **Focus:** a region of interest highlights a detail while keeping its surrounding context visible.

A shared color scheme ensures visual consistency within a documentation set. A temporarily inverted annotation style keeps markings visible over backgrounds that match the chosen accent color.

## Design principles

1. **Ease of use first.** A non-expert should complete an annotation without training.
2. **Zero installation.** The deliverable is one standalone HTML file that runs in a browser.
3. **Local by default.** No account, upload, server, telemetry, or network dependency is required.
4. **Focused scope.** Resist features that turn the editor into a general-purpose graphics suite.
5. **Consistent output.** Shared colors, intuitive controls, per-tool histories, native-resolution PNG export.
6. **Portable, editable work.** Projects can be saved and resumed from local ZIP files.
7. **Transparent longevity.** Open source, documented formats and reproducible tests lower maintenance risk.

## Non-goals

The studio is not designed for photo retouching, illustration, layered graphic composition, multi-user collaboration, or cloud storage. Every proposed feature should be judged by whether it helps users go from *screenshot* to *clear documentation* faster.

## Trust and security

Local-first design reduces unnecessary data transfer but is not a security guarantee. Imported images and ZIP projects are untrusted input. Follow the validation and testing guidance before changing file parsers or exports.
