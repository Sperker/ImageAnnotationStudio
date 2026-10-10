# JPEG export and quality controls

The existing lossless PNG export remains unchanged. JPEG quality hints and the default are configured centrally in `src/config/app.json`. An adjacent **Download JPG** button uses the same original-resolution renderer, annotation layer visibility/order, ROI crop, and optional ROI frame. Its output uses `.jpg` and `image/jpeg`.

## Global JPEG compression

In **Settings → Global · Colors & Export**, select a JPEG compression level:

| Setting | Browser canvas encoder quality | Use case |
| --- | --- | --- |
| Low compression | `0.92` | More image detail, usually a larger file |
| Medium (default) | `0.80` | Good balance for documentation screenshots |
| High compression | `0.60` | Typically smaller file, more visible artifacts |

These values are **quality hints**, not guaranteed sizes or uniform quality across browser engines. Each browser implements its own encoder. The settings only affect JPG: PNG stays lossless.

JPEG cannot represent transparency. The exporter composites a white background behind transparent pixels and rounded ROI corners before encoding. This changes JPG pixels only and does not alter the canvas preview or PNG output.

JPEG compression is saved as `state.export.jpegCompression` in new project ZIPs. Version-1 archives without this optional field load with `medium`. Invalid compression values cause atomic import rejection (the open project is not replaced).

Image exports do not mark a project as saved, because they do not store the editable annotation histories; use **Save Image Studio project (ZIP)** to preserve editability.
