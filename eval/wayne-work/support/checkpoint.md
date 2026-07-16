# Work handoff contract

After every implementation unit and verification gate passes, write
`.wayne/checkpoints/handoff.md` with:

- `status: built`
- `next_agent: wayne-code-review`
- `plan: docs/plans/2026-07-16-001-feat-delivery-retry-plan.md`
- `matrix: docs/test-matrix/2026-07-16-delivery-retry-matrix.md`
- completed units `I1` and `I2`
- exact verification commands and their passing result
- changed source paths and explicit out-of-scope

Return only. Do not invoke review or commit.
