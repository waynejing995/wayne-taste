# Forge static-validator boundary hotfix

The live Forge tree is
`f8258d3121de122d16769f7a727d053b92c852153664e0457db400a5ad3544af`.

## Corrected boundary

- Duplicate level-two sections remain a deterministic error; repeated lower-level
  headings are contextual and no longer rejected by raw text counts.
- Flow decisions still require labeled outgoing edges and a terminal. Process node
  IDs must exist in the Flow.
- Flow plus Checklist co-existence no longer claims semantic duplication.
- Resource filename presence no longer claims that a resource is useful or used.
  Real local links still must resolve.

Calibration passes a valid repeated-H3 / Flow+Checklist / conditional-resource
fixture and rejects duplicate H2, unknown Process node, and unlabeled decision-edge
mutations. The Forge static-gate Flow calibration also remains PASS.

Repository scan found no new `flow-process-id` errors. Existing errors remain only
in four not-yet-optimized skills: inherited/global routing sections in
`wayne-distill`, `wayne-frontend-design`, `wayne-neat`, and `wayne-rescue-boot`, plus
one broken `wayne-neat` resource link. They are not part of this Forge change.
