# Approved design request: bounded delivery retry

Design bounded retries for transient delivery failures. All product decisions are
already approved; do not ask the user to repeat them.

- Retry only transport timeouts and HTTP 429/503 responses.
- Maximum three attempts with deterministic exponential backoff.
- `Dispatcher` remains the sole lifecycle owner; no persistence is added.
- A terminal failure remains `FAILED` and exposes its final reason.
- Duplicate submit calls for the same delivery ID are idempotent.
- Success means the design has explicit ownership, transitions, failure behavior,
  observability, rollback, and user-visible E2E verification.
- Out of scope: new storage, distributed workers, UI work, and implementation.
- The user approves the recommended approach if it satisfies every item above.
