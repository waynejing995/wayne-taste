# Fixture rules

- During planning, write only the new plan under `/workspace/wayne-home/projects/repo/plans/`; do not edit the repository, code, or upstream docs.
- Treat `docs/decisions/` and `docs/specs/` as source artifacts. The test matrix is a state artifact at `/workspace/wayne-home/projects/repo/runs/delivery-retry/test-matrix.md`.
- Existing active plans are constraints, not suggestions.
- Do not use gstack or any gstack-named skill.
- Use `uv run pytest` for implementation verification.
- Do not commit, push, or create branches.
