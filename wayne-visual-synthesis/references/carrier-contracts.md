# Carrier Contracts

Use this reference when an image contains charts, tables, flowcharts, architecture diagrams, documents, maps, equations, dense text blocks, or dense UI panels.

## Rule

A visual information carrier is not complete until its semantic equivalent satisfies the relevant contract below.

Every equivalent must include:

- `source_refs`: ledger refs for all text/elements used.
- `required_fields`: the contract fields for that carrier kind.
- `filled_fields`: fields actually populated.
- `missing_fields`: required fields that are absent, obscured, unreadable, or not present.
- `coverage`: `complete`, `partial`, or `blocked`.
- `confidence`: `high`, `medium`, or `low`.

If any required field is missing, the equivalent and its region cannot be `complete`.

If DOM/SVG/accessibility tree/OCR/source text is available, use it to verify visible text. When source-backed text conflicts with visual reading, keep the source-backed value and record the visual ambiguity.

## Required Fields

| Kind | Required fields |
|------|-----------------|
| `chart` | `title`, `chart_type`, `x_axis`, `y_axis`, `legend`, `series[]`, `values[]`, `trends`, `outliers`, `takeaway` |
| `table` | `title`, `columns[]`, `rows[]`, `cells[]`, `status_markers[]`, `row_count`, `column_count` |
| `flowchart` | `title`, `nodes[]`, `edges[]`, `edge_directions[]`, `branch_conditions[]`, `loopbacks[]`, `annotations[]` |
| `diagram` | `title`, `components[]`, `boundaries[]`, `connections[]`, `directions[]`, `labels[]`, `status_markers[]` |
| `document` | `reading_order[]`, `headings[]`, `paragraphs[]`, `lists[]`, `tables[]`, `captions[]`, `annotations[]` |
| `text-block` | `reading_order[]`, `transcript`, `line_breaks`, `emphasis`, `unreadable_ranges[]` |
| `map` | `title`, `locations[]`, `routes_or_areas[]`, `legend`, `scale`, `directional_cues`, `highlighted_regions[]` |
| `equation` | `notation`, `variables[]`, `operators[]`, `layout`, `unreadable_symbols[]` |
| `dense-ui` | `purpose`, `controls[]`, `values[]`, `states[]`, `hierarchy[]`, `selected_filters[]`, `embedded_carriers[]`, `primary_workflow` |

## Carrier Notes

### Chart

Fill `values[]` per visible category or mark a value `unreadable`. Use approximate values only when exact values are not printed, and label them approximate. Do not stop at "higher/lower"; include the data behind the claim.

### Table

List headers and every visible cell in row order. Preserve row labels, status pills, merged cells, and visible empty cells. If the table continues off-screen, list visible rows and mark the rest missing.

### Flowchart

Represent the flow as a directed edge list. Do not describe arrows without direction. Include dashed/solid style only when it changes meaning, such as optional path or loopback.

### Diagram

List components and connections. Include boundaries, groups, direction labels, protocols, status markers, callouts, and legend items when visible.

### Document or Text Block

Preserve reading order. The semantic equivalent must be the original visible text transcript, not a summary, paraphrase, translation, or interpretation. Do not merge lines if line breaks carry meaning. Mark unreadable ranges with location and reason instead of guessing. Put any summary outside the semantic equivalent, usually in `Synthesis`.

### Map

List visible places, routes, highlighted areas, legend items, scale, and directional cues. If scale or north arrow is absent, put it in `missing_fields` only when the map needs it for interpretation.

### Equation

Transcribe exact notation when readable. Preserve superscript/subscript, fractions, roots, matrices, alignment, and grouped expressions. Mark unreadable symbols explicitly.

### Dense UI

State the panel purpose, controls, values, states, hierarchy, selected filters, and primary workflow. Any embedded chart/table/diagram gets its own equivalent and is referenced from `embedded_carriers[]`.
