# Visual Element Ledger contract

Build one ledger per image. Tables are the default user-visible form; JSON is
optional. Stable references make every later statement traceable.

## IDs and facets

| Facet | IDs | Required evidence |
|---|---|---|
| canvas | — | source, dimensions or unknown, orientation, context, theme/state, density |
| regions | `R1` | name, location, role, summary, `complete/partial/blocked`, limitation |
| elements | `R1.E1` | type, label, location, function/role, state, style, text/group refs |
| text | `R1.T1` | verbatim text, location, role, `clear/partial/unreadable`, reason |
| targetable structures | element ref | identity, geometry/space, z-order, occlusion, handle, mask, refs, confidence |
| groups | `G1` | pattern, exact/approximate count, members, variations |
| semantic equivalents | `S1` | carrier ref/kind, source refs, required/filled/missing fields, content, coverage, confidence |
| relationships | `REL1` | type, refs, direction or meaning |
| quality issues | `Q1` | severity, affected refs, issue, visible evidence |

Relationship types include containment, alignment, connection, overlap, pointing,
sequence, adjacency, and hierarchy. Group decoration only when it has no distinct
semantic role; otherwise list members or labels.

## Coverage rules

- Account for every top-level region, visible text cluster, control, link, input,
  icon, badge, status, carrier, media item, overlay, object/person, annotation, and
  meaningful decoration.
- Record significant negative space, crop, clipping, overlap, overflow, blur, low
  contrast, broken media, misalignment, and unreadable text.
- A large unexplained area, unreadable unmarked text, or missing carrier field makes
  coverage partial or blocked.
- Use measured coordinates only when a tool supplied them. Otherwise use verbal or
  explicitly approximate geometry.

## Output order

```markdown
## Visual Element Ledger

## Coverage
## Regions
## Elements
## Text
## Targetable Structures
## Groups
## Semantic Equivalents
## Relationships
## Quality Issues
## Synthesis
```

Omit an empty detail table only when the coverage section records its zero count.
`Synthesis` is short, derived from ledger refs, and last. A compact user request may
compress tables but cannot remove the per-image ledger or carrier transcript.
