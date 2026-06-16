# Targetable Structure

Use this reference when the image contains objects or UI elements that may need to be addressed individually later for editing, annotation, QA, prompt refinement, or comparison.

## Rule

The VEL should preserve object identity, geometry, layer order, and source handles when available. This does not imply editing. It only makes visual elements addressable.

Every targetable structure entry should include:

- `target_ref`: VEL element or region id.
- `identity`: stable name for the visual object.
- `geometry`: approximate location or measured bounding box.
- `coordinate_space`: `normalized`, `pixel`, `verbal`, or `unknown`.
- `z_order`: foreground/background/layer order when inferable.
- `occlusion`: whether the element covers or is covered by another element.
- `source_handle`: DOM node, SVG node, canvas object, layer id, mask id, OCR box, or `none`.
- `mask_status`: `available`, `recommended`, `not-needed`, or `unavailable`.
- `group_ref`: repeated group id when applicable.
- `relationship_refs`: containment, overlay, alignment, connection, or hierarchy refs.
- `semantic_refs`: semantic equivalent refs when this target is a chart/table/diagram/document/text carrier.
- `confidence`: `high`, `medium`, or `low`.

## Geometry

Use measured coordinates only when a tool provides them. Otherwise use verbal regions such as `upper-right KPI card`, `center modal`, or `bottom-left table row 2`.

When normalized coordinates are used, define them as `[x, y, width, height]` in image-relative 0-1 units.

## Layer And Occlusion

Record overlay relationships explicitly:

```json
{
  "target_ref": "R9.E1",
  "identity": "Deployment Gate modal",
  "geometry": "center-right overlay",
  "coordinate_space": "verbal",
  "z_order": "foreground",
  "occlusion": {
    "covers": ["R4.E5", "R4.E7", "R6.E1"],
    "covered_by": []
  },
  "source_handle": "none",
  "mask_status": "recommended",
  "relationship_refs": ["REL10"],
  "semantic_refs": ["S6"],
  "confidence": "high"
}
```

## Source Handles

Prefer real handles over visual guesses:

- Browser UI: DOM node, accessibility node, screenshot bounding box.
- SVG: element id, tag path, bounding box.
- Canvas/Figma-like surfaces: object id, layer id, mask id.
- OCR: word or line bounding boxes.
- Raster-only image: verbal geometry plus `mask_status: recommended`.

If no source handle is available, say so directly.
