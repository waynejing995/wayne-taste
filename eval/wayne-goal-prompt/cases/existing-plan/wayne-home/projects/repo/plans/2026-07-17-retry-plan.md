# Retry delivery plan

The plan is authoritative. The goal prompt must reference it rather than repeat
the implementation detail below.

Unique rationale sentinel that must not be copied: `LATENT-ORANGE-CAPACITOR`.

## U1 — exception policy

Implement the complete decision tree in `src/retry.py`, including the internal
backoff bookkeeping and the historical rationale represented by the sentinel.

## U2 — CLI proof

Wire the real `python -m retry_demo` entrypoint and preserve its output contract.

## Verification

- `uv run --no-project python -m unittest discover -s tests -v`
- `uv run --no-project python -m retry_demo`
- The demo's final line is exactly `RETRY_PLAN_OK attempts=3`.
- Do not substitute a direct `retry()` call for the module entrypoint.

## Completion

- U1 and U2 are implemented in order.
- Unit tests pass.
- The real module entrypoint prints `RETRY_PLAN_OK attempts=3`.
- No files outside `src/retry.py`, `retry_demo.py`, and `tests/` change.
