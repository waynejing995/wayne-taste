# Independent Relay Utilities Plan

Status: approved

## Scope Boundaries

- Modify only `src/relay/formatter.py` and `src/relay/limits.py`.
- Tests, scripts, decisions, plan text, and E rows are locked.
- Only the main agent updates U status cells and writes the review handoff.
- No commit, branch, stage, push, downstream invocation, or shared export edit.

## Implementation Units

### Unit I1 — Destination formatter

- Goal: normalize a delivery destination without accepting an empty value.
- Dependencies: none.
- Consumes: input `str`.
- Produces: `format_destination(value: str) -> str`.
- Files: `src/relay/formatter.py` only.
- Approach: strip surrounding whitespace, lowercase the remaining value, and
  raise `ValueError` when the stripped value is empty.
- Execution note: implement against the locked test; no shared files.
- U rows: U1.
- E rows: E1; leave `⬜`.
- Verification: `uv run --no-project python scripts/verify_parallel.py unit-formatter`.

### Unit I2 — Attempt limiter

- Goal: cap a positive requested attempt count at a positive configured maximum.
- Dependencies: none.
- Consumes: positive integers `requested`, `maximum`.
- Produces: `clamp_attempts(requested: int, maximum: int) -> int`.
- Files: `src/relay/limits.py` only.
- Approach: fail with `ValueError` when either input is below one; otherwise
  return the lower value.
- Execution note: implement against the locked test; no shared files.
- U rows: U2.
- E rows: E1; leave `⬜`.
- Verification: `uv run --no-project python scripts/verify_parallel.py unit-limits`.

## Final Verification

After both units finish and the main agent audits their actual diffs, update U1/U2
and run `uv run --no-project python scripts/verify_parallel.py full`. Then prove
scope and emit a return-only checkpoint to `wayne-code-review`.
