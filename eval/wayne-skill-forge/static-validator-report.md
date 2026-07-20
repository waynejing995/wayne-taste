# Forge static-validator boundary hotfix

The live Forge tree is
`f2f0802a7c45fc58b63410a07514ac66c140583a17bda800d0c1403a0cc9c9c4`.

## Corrected boundary

- Duplicate level-two sections remain a deterministic error; repeated lower-level
  headings are contextual and no longer rejected by raw text counts.
- Flow decisions still require labeled outgoing edges and a terminal. Process node
  IDs must exist in the Flow.
- Flow plus Checklist co-existence no longer claims semantic duplication.
- Resource filename presence no longer claims that a resource is useful or used.
  Real local links still must resolve.
- Markdown-like examples inside fenced or inline code are not links. A matching
  prose link to the same missing target remains a deterministic error.

Calibration passes a valid repeated-H3 / Flow+Checklist / conditional-resource
fixture, inline/fenced link examples, and rejects duplicate H2, unknown Process
node, unlabeled decision-edge, and real broken-link mutations. The Forge
static-gate Flow calibration also remains PASS.

Repository scan found no new `flow-process-id` errors. Existing errors remain only
in four not-yet-optimized skills: inherited/global routing sections in
`wayne-distill`, `wayne-frontend-design`, `wayne-neat`, and `wayne-rescue-boot`.
They are not part of this Forge change.
