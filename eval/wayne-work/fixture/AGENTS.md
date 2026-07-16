# Mini-repository implementation rules

- Execute the approved plan exactly. Do not redesign its API or edit upstream
  decision/plan inputs.
- Locked files: `tests/**`, `scripts/verify.py`, `docs/decisions/**`,
  `docs/plans/**`, and every E row in the test matrix.
- Allowed implementation writes: `src/relay/models.py`, `src/relay/service.py`,
  `src/relay/__init__.py`, U status cells in the matrix, `.eval/verify-events.jsonl`,
  and `.wayne/checkpoints/handoff.md`.
- Do not commit, branch, stage, push, or invoke downstream review/ship skills.
- Run Python through `uv run --no-project python`.
