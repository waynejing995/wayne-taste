# Design-eval repository rules

- This task is design-only. Do not modify `src/`, implement code, or write any
  implementation plan into the repository.
- Do not branch, push, open a PR, publish, or install anything. The only commit
  you may make is the CMT spec commit: `git add -- docs/specs/<topic>.md` (plus
  `GLOSSARY.md` only if this run changed it), then `git commit -s --` that same
  pathspec. Never edit git config.
- gstack and the legacy `plan-ceo-review` / `plan-eng-review` entrypoints are
  prohibited and unavailable.
- Do not assume a replacement review command. Discover the repository-supported
  independent-review interface from project files. Preserve each voice's latest
  report as `/workspace/wayne-home/projects/repo/runs/<topic>/review-{product|engineering}.md`; resolve
  `REVISE` and rerun until `PASS`.
- Run state lives in `/workspace/wayne-home/projects/repo/`, outside this repository. The only
  durable design artifact this repository keeps is the living spec at `docs/specs/<topic>.md`.
- Use `/workspace/support/test-design.md` for the test-matrix contract,
  `/workspace/support/cybernetics-lens.md` when the lens applies, and
  `/workspace/support/checkpoint.md` for the final handoff packet.
- Design artifacts are English. The user-visible response is concise Chinese.
