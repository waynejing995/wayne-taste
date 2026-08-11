# Design-eval repository rules

- This task is design-only. Do not modify `src/`, implement code, or write under
  `docs/plans/`.
- Do not commit, branch, push, publish, or install anything.
- gstack and the legacy `plan-ceo-review` / `plan-eng-review` entrypoints are
  prohibited and unavailable.
- Do not assume a replacement review command. Discover the repository-supported
  independent-review interface from project files. Preserve each voice's latest
  report as `.wayne/runs/<topic>/review-{product|engineering}.md`; resolve
  `REVISE` and rerun until `PASS`.
- Run state lives in `.wayne/runs/<topic>/`. The only durable design artifact this
  repository keeps is the living spec at `docs/specs/<topic>.md`.
- Use `/workspace/support/test-design.md` for the test-matrix contract,
  `/workspace/support/cybernetics-lens.md` when the lens applies, and
  `/workspace/support/checkpoint.md` for the final handoff packet.
- Design artifacts are English. The user-visible response is concise Chinese.
