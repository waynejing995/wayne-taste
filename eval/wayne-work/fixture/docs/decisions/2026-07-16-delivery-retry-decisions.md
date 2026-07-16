# Decision Log: Delivery Retry

Status: design-approved

| # | Decision | Rationale |
|---|---|---|
| 1 | Retry only `TimeoutError` | Permanent errors must fail immediately. |
| 2 | Inject sleeper | Tests and callers own time; service stays deterministic. |
| 3 | Delivered IDs are idempotent | Retried requests must not resend. |
| 4 | Exhausted transient retries persist FAILED and re-raise | Failure remains observable. |
