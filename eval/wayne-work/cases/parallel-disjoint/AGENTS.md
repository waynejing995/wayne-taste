# Parallel fixture implementation rules

- Execute the approved plan exactly; do not redesign its APIs.
- Locked: `tests/**`, `scripts/**`, `docs/decisions/**`, the approved plans under `/workspace/wayne-home/projects/repo/plans/`, and E rows.
- I1 may write only `src/relay/formatter.py`.
- I2 may write only `src/relay/limits.py`.
- Only the main agent may update U status cells in
  `/workspace/wayne-home/projects/repo/runs/parallel-units/test-matrix.md`, run full
  verification, integrate, or write `/workspace/wayne-home/projects/repo/checkpoints/**`.
- Workers do not commit, branch, stage, push, or edit another unit's path.
- Run Python through `uv run --no-project python`.
