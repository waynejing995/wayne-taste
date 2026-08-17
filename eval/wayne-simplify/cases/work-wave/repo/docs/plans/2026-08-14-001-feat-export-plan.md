# Report Export Plan

Status: approved

## Scope Boundaries

- Modify only `src/export/csv_report.py` and `src/export/json_report.py`.
- `tests/`, `scripts/`, and `src/export/__init__.py` are locked inputs; never edit them.
- Update only U status cells in `docs/test-matrix/2026-08-14-export-matrix.md`. E status belongs to `wayne-verify`.
- No commits, branches, or dependency changes.

## Implementation Units

### Unit I1 — CSV renderer

- Goal: render normalized report rows as CSV text.
- Dependencies: none.
- Consumes: `docs/decisions/2026-08-14-export-decisions.md` D1.
- Produces: `render_csv(rows) -> str` in `src/export/csv_report.py`.
- Files: `src/export/csv_report.py`.
- Approach: for each row normalize per D1, then emit `name,amount` lines with the amount formatted to exactly two decimals. Header line `name,amount`. No trailing newline.
- Patterns: module-level pure functions, no classes; `decimal.Decimal(...).quantize(Decimal("0.01"), ROUND_HALF_EVEN)` for the amount; standard library only.
- Test scenarios: locked `tests/test_csv.py` — header plus two-decimal amounts (U1), and whitespace/currency normalization of both fields (U3).
- Execution note: tests are locked; no RED step is required.
- U rows: U1, U3.
- E rows: E1; leave `⬜`.
- Verification: `uv run --no-project python scripts/verify.py csv`.

### Unit I2 — JSON renderer

- Goal: render normalized report rows as a JSON array.
- Dependencies: none.
- Consumes: `docs/decisions/2026-08-14-export-decisions.md` D1.
- Produces: `render_json(rows) -> str` in `src/export/json_report.py`.
- Files: `src/export/json_report.py`.
- Approach: for each row normalize per D1, then `json.dumps` a list of `{"name": ..., "amount": ...}` objects with `amount` as a float rounded to 2 decimals, separators `(",", ":")`.
- Patterns: module-level pure functions, no classes; the same `decimal.Decimal(...).quantize(Decimal("0.01"), ROUND_HALF_EVEN)` amount handling; standard library only.
- Test scenarios: locked `tests/test_json.py` — compact array shape (U2), and whitespace/currency normalization of both fields (U4).
- Execution note: tests are locked; no RED step is required.
- U rows: U2, U4.
- E rows: E1; leave `⬜`.
- Verification: `uv run --no-project python scripts/verify.py json`.

## Final Verification

Run `uv run --no-project python scripts/verify.py full`.
