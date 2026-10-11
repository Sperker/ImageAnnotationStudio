# Image Studio project ZIP, format version 1

A project is an ordinary ZIP archive with **two uncompressed entries**:

The suggested download name includes the local date and time down to seconds, followed by the original image name, for example `2026-10-11 (Time 11-23-22) _ 092_image-studio.zip`. This timestamp affects only the outer filename, not the archive format. Existing project ZIPs still import normally.

```
project.json
original.png  # or original.jpg etc., determined by the original filename
```

`project.json` contains `format: "ImageAnnotationStudio"`, `version: 1`, an export timestamp, metadata about the original image, and a `state` object:

| JSON field | Meaning |
| --- | --- |
| `image.entry`, `image.filename`, `image.mime`, `image.width/height` | Original image identity and dimensions |
| `state.front` | Front/back order of `arrows` and `numbering` |
| `state.active`, `state.visible` | Active tool and per-layer visibility |
| `state.items` | Original-pixel arrow, numbering and ROI geometries |
| `state.hist[tool].undo/redo` | Tool-specific history including forward/redone steps |
| `state.selection`, `state.preferred` | Selected object indices and Standard/Inverted preferences |
| `state.settings`, `state.palette` | Tool options and global colors |
| `state.baseScale`, `state.view` | Initial layout scale / current image view |
| `state.lang` | UI language (DE/EN; older HU projects fall back to DE) |
| `state.export` | Export scope, optional ROI frame, timestamp, and JPEG compression (`low`, `medium`, `high`; optional for legacy v1 files, default `medium`) |

### Compatibility

The archive format is versioned independently of the application version. Version 1 projects should remain importable in future releases. Future incompatible formats must increment `version` and provide a migration path; do not silently reinterpret old coordinates or history snapshots. This is a **project file**, not a general ZIP or image format.

### Security

Project ZIPs should be treated as untrusted: size limits, CRCs, exact entries, JSON schema and decoded image dimensions are validated on import. Do not edit/repackage a project without preserving the expected structure. Keep source screenshots and project files private if they contain confidential customer or system information.
