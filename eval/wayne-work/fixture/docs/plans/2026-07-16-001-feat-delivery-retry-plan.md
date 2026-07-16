# Bounded Delivery Retry Plan

Status: approved

## Scope Boundaries

- Modify only `src/relay/models.py`, `src/relay/service.py`, and exports in
  `src/relay/__init__.py`.
- Tests and verification scripts are locked inputs; never edit them.
- Update only U status cells in the test matrix. E status belongs to `wayne-verify`.
- No commits, branches, dependency changes, CLI, persistence redesign, or real sleep.

## Implementation Units

### Unit I1 — Retry policy and state

- Goal: define the exact retry policy and retry-pending lifecycle state.
- Dependencies: none.
- Consumes: existing `Delivery` and `DeliveryStatus`.
- Produces: exported `RetryPolicy`; `DeliveryStatus.RETRY_PENDING`.
- Files: `src/relay/models.py`; `src/relay/__init__.py`.
- Approach: frozen dataclass with `max_attempts >= 1`, non-negative delays, and
  exactly `max_attempts - 1` backoff entries. `delay_after(n)` returns the delay
  after failed attempt `n`, where attempts are 1-based.
- Execution note: test-first. Run unit verification before implementation and
  preserve the RED event; implement only after seeing the missing contract fail.
- U rows: U1.
- E rows: E1, E2; leave `⬜`.
- Verification: `uv run --no-project python scripts/verify.py unit`.

### Unit I2 — Retry execution and idempotency

- Goal: execute transient retries without retrying permanent failures or delivered IDs.
- Dependencies: I1.
- Consumes: `RetryPolicy`, `DeliveryStatus.RETRY_PENDING`, `InMemoryStore`.
- Produces: `DeliveryService(store, send, sleep)` and
  `deliver(delivery_id, payload, policy)`.
- Files: `src/relay/service.py`; `src/relay/__init__.py`.
- Approach: each send increments `attempts`. Catch only `TimeoutError` for retry;
  before another attempt, persist RETRY_PENDING and call the injected sleeper with
  `policy.delay_after(attempt)`. On exhaustion persist FAILED and re-raise the last
  TimeoutError. Any other exception persists FAILED and re-raises without retry.
  A previously DELIVERED ID returns its existing object without sending.
- Execution note: implement against locked U2–U4 tests; do not broaden exception handling.
- U rows: U2, U3, U4.
- E rows: E1, E2; leave `⬜`.
- Verification: `uv run --no-project python scripts/verify.py unit`.

## Final Verification

Run `uv run --no-project python scripts/verify.py full`. Then inspect `git diff`
against the scope boundaries and emit the checkpoint handoff to code review.
