---
name: wayne-visual-synthesis
description: >
  Wayne-style exhaustive image reading and visual element extraction. Use when the user asks to describe an image, read a screenshot, extract all visible UI elements, transcribe visible text, inventory objects, parse charts/tables/diagrams/documents, or produce structured visual evidence from one or more images. The mandatory mechanism is a Visual Element Ledger: every meaningful visible region, text item, control, icon, media item, object, relationship, and quality issue must be accounted for before any summary.
---

# Wayne Visual Synthesis

Read images into structured visual evidence and semantic equivalents. Do not compare images. Do not issue acceptance verdicts.

This skill produces a complete Visual Element Ledger (VEL) for each image, then derives concise descriptions, targetable structures, and complex text equivalents from that ledger. Downstream workflows may compare ledgers, but comparison is not this skill's responsibility.

## Inherits from ~/.claude/CLAUDE.md

This skill inherits the Wayne control-plane invariants and does not redeclare them. The following are assumed and MUST NOT be repeated below:

- Language Rules (Chinese to user, English to files)
- Engineering Principles (KISS / YAGNI / DRY / SSoT / Fail-Loud / Push-Don't-Poll / Delete>Add)
- Code Standards (uv run python, markdown tables)
- Behavior Baselines (Think Before / Simplicity / Surgical / Goal-Driven)
- Skill invocation rule (proportional effort)

This skill only specifies image reading, element extraction, targetable structure extraction, semantic equivalent extraction, coverage control, and visual evidence synthesis.

## Files Written

Visual Element Ledgers, targetable structures, semantic equivalents, OCR notes, image reading reports, screenshot inventory reports.

## Single Source of Truth

The Visual Element Ledger is the only source of truth. Every summary, description, OCR result, and visual observation must trace back to ledger entries.

No ledger -> no summary.

No carrier contract -> no complete coverage for charts, tables, diagrams, documents, maps, equations, or text-heavy images.

## Description Quality Model

Build descriptions from four layers:

1. **Purpose**: describe the information or function represented by the image, not just pixels.
2. **Regions**: localize the description by top-level regions and meaningful sub-regions.
3. **Entities**: enumerate objects/elements, visible text, attributes, and state.
4. **Relations**: record containment, alignment, sequence, connection, overlay, hierarchy, and interaction.

A good image description is complete enough to reconstruct the image's meaning, not necessarily every pixel. Decorative elements still get ledger entries when they affect composition; otherwise group them explicitly as decoration.

For visual information carriers, an element ledger is not enough. A chart, table, flowchart, architecture diagram, document scan, equation, map, or dense UI panel must also satisfy its carrier contract: required fields, source refs, missing fields, and confidence.

## Non-Goals

- No image comparison.
- No semantic diff.
- No visual regression verdict.
- No design acceptance verdict.
- No pixel-diff interpretation.

If the user asks to compare images, produce one VEL per image and stop there unless another skill or explicit user instruction handles the comparison.

## Coverage Contract

Before summarizing an image, account for:

- Every top-level visual region.
- Every visible text cluster, or an explicit `unreadable` entry.
- Every visible UI control, link, input, icon, badge, status marker, chart, table, image/media item, overlay, object, person, annotation, or meaningful decoration.
- Every independently addressable visual object has targetable structure when identity, geometry, layer order, occlusion, or source handles matter.
- Every repeated family of elements with count or approximate count.
- Every meaningful visual relationship: containment, alignment, grouping, overlay, sequence, connection, adjacency, hierarchy.
- Every visual information carrier's semantic equivalent: chart data/trends, table headers/rows/cells, diagram nodes/edges/flows, document reading order, map legend/routes/locations, equation notation, or dense text transcript.
- Every obvious quality issue: clipping, overlap, overflow, low contrast, blur, broken image, misalignment, wrong crop, unreadable text.
- Significant empty/negative space if it affects composition or meaning.

Do not use vague catch-alls like "etc.", "various icons", "some cards", or "several items" unless the group has an explicit count or approximate count.

If image quality prevents full coverage, mark coverage as `partial` or `blocked`. Do not guess.

## Semantic Equivalent Contracts

Create one `semantic_equivalent` entry for every chart, table, diagram, document, map, equation, dense text block, or complex UI region.

For carrier-specific required fields, read [references/carrier-contracts.md](references/carrier-contracts.md) whenever any of these carrier kinds appears. Do not continue to synthesis until the relevant contract has been applied.

Every equivalent includes:

- `source_refs`: ledger refs for all text/elements used.
- `missing_fields`: required fields that are absent, obscured, or unreadable.
- `coverage`: `complete`, `partial`, or `blocked`.
- `confidence`: `high`, `medium`, or `low`.

If any required field is missing, the equivalent and its region cannot be `complete`. If DOM/SVG/accessibility tree/OCR/source text is available, use it to verify visible text. When source-backed text conflicts with visual reading, keep the source-backed value and record the visual ambiguity.

For document, text-block, and text-heavy image carriers, the semantic equivalent is the original visible text transcript in reading order. Do not summarize, paraphrase, translate, or normalize the transcript. Put summaries only in `Synthesis`.

## Targetable Structures

Use targetable structures when visual objects may need to be addressed individually later for annotation, QA, prompt refinement, editing, or comparison. This is visual structure, not an editing workflow.

If an image contains object/layer/source handles, masks, DOM boxes, SVG nodes, canvas objects, OCR boxes, or clear overlay relationships, read [references/targetable-structure.md](references/targetable-structure.md) before final output.

## Mode Selection

| User intent | Mode |
|-------------|------|
| "describe this image" | `image-reading` |
| "what elements are here" | `element-ledger` |
| "read this screenshot" | `ui-ledger` |
| "extract text" / OCR | `text-ledger` |
| chart, table, dashboard | `data-visual-ledger` |
| diagram, architecture image | `diagram-ledger` |
| document scan | `document-ledger` |
| addressable objects/elements/layers | `targetable-structure` |
| multiple images without comparison | `multi-image-ledger` |

Pick the mode from context. Ask only if the image type or output detail level is unknowable.

## Backend Policy

Use the strongest available observation source:

1. Native multimodal image input, if the image is attached or viewable.
2. A vision MCP/tool, if configured, for local paths or URLs.
3. Browser screenshot plus accessibility/tree snapshot for live UI pages.
4. OCR or metadata tools as supporting evidence when text or dimensions matter.
5. Local image viewing when manual inspection is available.

Fail loud if no usable vision backend can inspect the image. Do not infer observations from filenames, alt text, or user intent.

## Ledger IDs

Use stable ids:

- `R1`, `R2`, ... for regions.
- `R1.E1`, `R1.E2`, ... for visual elements inside a region.
- `R1.T1`, `R1.T2`, ... for visible text items.
- `G1`, `G2`, ... for repeated groups.
- `REL1`, `REL2`, ... for visual relationships.
- `Q1`, `Q2`, ... for quality issues.

## Visual Element Ledger Schema

Use this schema internally. Expose tables by default; expose JSON only when useful.

```json
{
  "image_id": "image-1",
  "source": "path-or-url-or-attachment",
  "context": "ui|photo|chart|diagram|document|mixed|unknown",
  "canvas": {
    "dimensions": "known dimensions or unknown",
    "orientation": "landscape|portrait|square|unknown",
    "theme_or_state": "light|dark|loading|error|unknown",
    "overall_density": "sparse|normal|dense|unknown"
  },
  "regions": [
    {
      "id": "R1",
      "name": "header|sidebar|main|foreground|background|plot area|page body|custom",
      "location": "top|bottom|left|right|center|full canvas|approximate area",
      "role": "navigation|content|control surface|decoration|data display|subject|unknown",
      "summary": "",
      "coverage": "complete|partial|blocked",
      "coverage_note": ""
    }
  ],
  "elements": [
    {
      "id": "R1.E1",
      "type": "button|link|input|card|icon|image|chart|table|axis|legend|shape|object|person|annotation|decoration|unknown",
      "label": "",
      "location": "approximate location within region",
      "visual_role": "primary action|content|status|data|decoration|subject|unknown",
      "state": "default|selected|disabled|loading|error|unknown",
      "style": "color, shape, size, typography, material",
      "text_refs": ["R1.T1"],
      "group_ref": "G1 or null"
    }
  ],
  "text": [
    {
      "id": "R1.T1",
      "text": "",
      "location": "approximate location",
      "role": "heading|label|body|button|caption|data|axis|legend|unknown",
      "readability": "clear|partial|unreadable",
      "reason_if_unreadable": ""
    }
  ],
  "targetable_structures": [
    {
      "target_ref": "R1.E1",
      "identity": "stable object name",
      "geometry": "measured bbox, normalized bbox, or verbal region",
      "coordinate_space": "pixel|normalized|verbal|unknown",
      "z_order": "foreground|middle|background|unknown",
      "occlusion": {"covers": [], "covered_by": []},
      "source_handle": "DOM/SVG/layer/mask/OCR handle or none",
      "mask_status": "available|recommended|not-needed|unavailable",
      "group_ref": "G1 or null",
      "relationship_refs": ["REL1"],
      "semantic_refs": ["S1"],
      "confidence": "high|medium|low"
    }
  ],
  "groups": [
    {
      "id": "G1",
      "pattern": "cards|rows|icons|list items|points|nodes|objects",
      "count": "exact or approximate",
      "member_refs": ["R1.E1"],
      "representative_description": "",
      "notable_variations": ""
    }
  ],
  "semantic_equivalents": [
    {
      "id": "S1",
      "carrier_ref": "R1.E1",
      "kind": "chart|table|flowchart|diagram|document|map|equation|dense-ui|text-block",
      "title": "",
      "source_refs": ["R1.E1", "R1.T1"],
      "required_fields": ["carrier-specific field names"],
      "fields": {
        "title": "",
        "structure": "carrier-specific structure",
        "content": "values, rows, transcript, notation, node-edge list, or other equivalent content",
        "takeaway": "trend, process meaning, document meaning, or empty if not inferable"
      },
      "missing_fields": [],
      "coverage": "complete|partial|blocked",
      "confidence": "high|medium|low"
    }
  ],
  "relationships": [
    {
      "id": "REL1",
      "type": "contains|aligns-with|connects-to|overlaps|points-to|sequence|hierarchy",
      "refs": ["R1.E1", "R1.E2"],
      "description": ""
    }
  ],
  "quality_issues": [
    {
      "id": "Q1",
      "severity": "critical|major|minor",
      "affected_refs": ["R1.E1"],
      "issue": "",
      "evidence": ""
    }
  ],
  "coverage_audit": {
    "region_count": 0,
    "element_count": 0,
    "text_count": 0,
    "targetable_structure_count": 0,
    "group_count": 0,
    "semantic_equivalent_count": 0,
    "relationship_count": 0,
    "unreadable_or_unknown_refs": [],
    "unexplained_areas": [],
    "coverage_verdict": "complete|partial|blocked"
  },
  "confidence": "high|medium|low"
}
```

## Sweep Protocol

Build the ledger in this order.

### Pass 1: Canvas

Identify image type, orientation, approximate dimensions if available, theme/state, density, and any obvious crop/blur/occlusion limits.

### Pass 2: Region Map

Divide the image into top-level regions before describing details.

For UI: header, sidebar, toolbar, main content, panels, cards, modal, footer, background.

For charts/tables: title, axes, plot area, legend, series, labels, notes.

For diagrams: title, nodes, edges/connectors, groups, labels, legend.

For photos: foreground subject, secondary subjects, background, text/signage, notable objects.

For documents: header, title, body blocks, tables, images, footer, annotations.

Choose region granularity by meaning. A simple photo may need only foreground/background/signage. A dashboard, chart, diagram, or document usually needs finer regions because layout and structure carry information.

### Pass 3: Leaf Elements

Sweep each region top-to-bottom and left-to-right. Enumerate meaningful leaf elements and assign ids. Foreground and overlays come before obscured background content.

### Pass 4: Targetable Structures

For independently addressable objects, controls, overlays, diagram nodes, chart series, text blocks, and image regions, record targetable structure before semantic equivalents.

If handles or masks are available, record them. If only the raster image is available, use verbal geometry and set `mask_status` to `recommended` when a precise downstream operation would need a mask.

### Pass 5: Text Ledger

Every visible text string must be transcribed, partially transcribed, or marked unreadable with a reason. For UI, map text back to related controls or content elements.

### Pass 6: Semantic Equivalents

For every visual information carrier, produce a contract-shaped text equivalent before grouping repeated elements:

- If any carrier is present, load [references/carrier-contracts.md](references/carrier-contracts.md) and apply the matching required fields.
- Charts: fill `chart_type`, axes, legend, series, per-category values or `unreadable`, trends, outliers, takeaway.
- Tables: fill columns, rows, visible cells, status markers, row/column counts.
- Flowcharts and diagrams: fill node list and directed edge list. Do not describe arrows without direction.
- Documents and text-heavy images: fill reading-order transcript; do not merge lines if line breaks carry meaning.
- Maps: fill locations, routes/areas, legend, scale, direction cues.
- Equations: fill exact notation or unreadable symbol markers.
- Dense UI panels: fill controls, values, states, hierarchy, selected filters, and embedded carrier refs.

If a chart, table, diagram, document, map, equation, or dense UI region lacks a valid carrier contract, coverage cannot be `complete`.

### Pass 7: Groups

Group repeated structures only after itemizing their pattern and count. If group members carry distinct meaning, list those members or their labels.

Acceptable:

- `G1: 8 table rows, same 5-column structure; row labels are listed in text refs.`
- `G2: about 12 small decorative stars; background decoration, no distinct semantic role.`
- `G3: 4 pricing cards; all card headings and primary buttons have element refs.`

### Pass 8: Relationships

Record visual relationships that affect meaning: hierarchy, containment, alignment, sequence, connector lines, arrows, overlay, adjacency, callouts.

For scene-like images, relationships are first-class evidence. "Person, horse, carriage" is weaker than "person riding carriage" and "horse pulling carriage."

### Pass 9: Quality Issues

Record visual defects or uncertainty: unreadable text, clipping, overlap, overflow, broken media, low contrast, blur, crop, ambiguity.

### Pass 10: Coverage Audit

Before writing the final answer, check:

- Does every region have `complete`, `partial`, or `blocked` coverage?
- Are there unexplained large areas?
- Are all text clusters accounted for?
- Are independently addressable objects represented in `targetable_structures` when structure matters?
- Do all charts, tables, diagrams, documents, maps, equations, and dense UI panels have semantic equivalents?
- Are all repeated groups counted?
- Are meaningful relationships recorded?
- Are unreadable/unknown areas explicitly listed?
- Is confidence justified?

If not, inspect again or mark the coverage verdict accordingly.

## Output Formats

### Default Report

```markdown
## Visual Element Ledger

## Coverage

| Metric | Value |
|--------|-------|
| Regions | {count} |
| Elements | {count} |
| Text items | {count} |
| Targetable structures | {count} |
| Groups | {count} |
| Semantic equivalents | {count} |
| Relationships | {count} |
| Coverage verdict | `complete|partial|blocked` |
| Confidence | `high|medium|low` |

## Regions

| Ref | Region | Location | Role | Coverage |
|-----|--------|----------|------|----------|

## Elements

| Ref | Type | Label | Location | Role | State | Style |
|-----|------|-------|----------|------|-------|-------|

## Text

| Ref | Text | Location | Role | Readability |
|-----|------|----------|------|-------------|

## Targetable Structures

| Target | Identity | Geometry | Z Order | Occlusion | Source Handle | Mask Status |
|--------|----------|----------|---------|-----------|---------------|-------------|

## Groups

| Ref | Pattern | Count | Notes |
|-----|---------|-------|-------|

## Semantic Equivalents

| Ref | Carrier | Kind | Required Fields | Filled Fields | Missing Fields | Coverage |
|-----|---------|------|-----------------|---------------|----------------|----------|

## Relationships

| Ref | Type | Refs | Meaning |
|-----|------|------|---------|

## Quality Issues

| Ref | Severity | Affected | Issue |
|-----|----------|----------|-------|

## Synthesis

{Short description derived from the ledger. Mention coverage limitations if any.}
```

### Compact Report

Use only when the user asks for a brief answer:

```markdown
## Synthesis

{brief description}

## Key Elements

| Ref | Element | Location | Notes |
|-----|---------|----------|-------|

## Coverage

`complete|partial|blocked` - {reason}
```

## Vision Backend Prompts

### Exhaustive Ledger Prompt

```text
Inspect this image and build an exhaustive Visual Element Ledger. First divide the image into top-level regions. Then sweep each region top-to-bottom and left-to-right. List every meaningful visible element, targetable structures for independently addressable objects, every visible text item, semantic equivalents for charts/tables/diagrams/documents/maps/equations/dense UI panels using carrier-specific required fields, repeated groups with counts, meaningful visual relationships, and quality issues. Do not use "etc.", "various", or vague group names. If something is unreadable, mark it unreadable with location and reason. Do not call a carrier complete while required fields are missing. Return coverage counts and confidence.
```

### OCR-Focused Prompt

```text
Extract all visible text from this image. Preserve structure, reading order, labels, headings, table rows, chart labels, button text, and captions. For partially readable text, return the readable fragment and mark the rest unreadable with location and reason.
```

### UI Screenshot Prompt

```text
Read this UI screenshot into a Visual Element Ledger. Identify regions, controls, visible text, icons, cards, tables, forms, status markers, overlays, targetable structures, relationships, carrier-specific semantic equivalents for embedded charts/tables/dense panels, and visual quality issues. Account for every primary action and every visible text cluster before summarizing. Verify version numbers, labels, and table cells against any available DOM/OCR/source text.
```

## Rules

- Ledger first. Summary second.
- Do not compare images.
- Do not provide pass/fail acceptance verdicts.
- Describe function for functional UI/image elements.
- Transcribe image text exactly when text is the content.
- For text-heavy images, put original text in the semantic equivalent; do not use a paraphrase as the equivalent.
- Use structured long descriptions for charts, diagrams, maps, dashboards, and documents.
- Produce targetable structures for independently addressable objects when geometry/layer/source identity matters.
- Produce semantic equivalents for charts, tables, diagrams, documents, maps, equations, and dense UI panels.
- Do not call coverage complete when a required carrier contract field is missing.
- Do not call coverage complete while any large visual region is unexplained.
- Do not silently normalize text; preserve punctuation, ellipses, line breaks, and version numbers when readable.
- Do not treat arrow diagrams as understood until every visible edge has a direction.
- Do not hide repeated elements behind vague wording.
- Do not infer exact coordinates or measurements unless measured by a tool.
- Use approximate locations unless exact measurement is available.
- Mark uncertainty directly; do not silently fill gaps.

## Verification Checklist

- Every image has its own Visual Element Ledger.
- Every top-level region has a coverage status.
- Every meaningful visible element has an id or belongs to a counted group.
- Every independently addressable object has targetable structure when geometry/layer/source identity matters.
- Every visible text cluster is transcribed, partially transcribed, or marked unreadable.
- Every chart, table, diagram, document, map, equation, and dense UI panel has a semantic equivalent.
- Meaningful relationships are listed.
- Quality issues and uncertainty are explicit.
- The final synthesis is derived from ledger entries only.
