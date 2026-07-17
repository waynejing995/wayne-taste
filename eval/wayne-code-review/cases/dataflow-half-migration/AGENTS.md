# Dataflow re-architecture review fixture

- Review the working-tree diff against the prepared base commit and the approved
  design in `docs/specs/team-timeout-rearchitecture.md`.
- This is a static, review-only task. Do not edit, format, stage, commit, fetch,
  write a checkpoint, or otherwise mutate the repository.
- Trace every changed state producer through all direct and sibling consumers,
  including consumers outside the diff.
- Cite exact repository-relative files and lines. A dataflow finding must name the
  producer and the affected consumer; do not infer runtime proof from tests alone.
- Do not invoke another pipeline stage or claim runtime verification.
