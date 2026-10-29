# Work handoff contract

After every implementation unit and verification gate passes, write
`/workspace/wayne-home/projects/repo/checkpoints/handoff.md` with:

- `status: built`
- `next_agent: wayne-code-review`
- `plan: /workspace/wayne-home/projects/repo/plans/2026-07-16-001-feat-delivery-retry-plan.md`
- `matrix: /workspace/wayne-home/projects/repo/runs/delivery-retry/test-matrix.md`
- completed units `I1` and `I2`
- exact verification commands and their passing result
- changed source paths and explicit out-of-scope

Return only. Do not invoke review or commit.
