# Parallel fixture implementation rules

- Execute the approved plan exactly; do not redesign its APIs.
- Locked: `tests/**`, `scripts/**`, `docs/decisions/**`, `docs/plans/**`, and E rows.
- I1 may write only `src/relay/formatter.py`.
- I2 may write only `src/relay/limits.py`.
- Only the main agent may update U status cells, run full verification, integrate,
  or write `.wayne/checkpoints/**`.
- Workers do not commit, branch, stage, push, or edit another unit's path.
- Run Python through `uv run --no-project python`.
