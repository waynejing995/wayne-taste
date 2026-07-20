# Delivery Retry Decisions

Status: approved
Owner: product-design

| ID | Decision | Rationale |
|---|---|---|
| D1 | `InMemoryDeliveryStore` is the sole owner of delivery records and the request-id index. | Idempotency state must not be split between service and store. |
| D2 | `delivery_id` is `sha256(request_id.encode()).hexdigest()[:12]`. | Retries and resumption need a stable observable identity. |
| D3 | Reusing a request ID with identical destination and body returns the existing delivery; different content raises `IdempotencyConflict`. | Duplicate requests must not create or silently overwrite work. |
| D4 | Add `DeliveryRequest` and `SubmitResult` data shapes; `DeliveryService.submit(request)` returns `SubmitResult`. | The created/existing distinction is part of the caller contract. |
| D5 | Delivery states are `pending`, `retry_wait`, `delivered`, and `failed`; attempts increment before invoking the sender. | State must describe the observable execution point. |
| D6 | `TransientDeliveryError` retries at 30, 60, then no further retry after the third failed attempt; `PermanentDeliveryError` fails immediately. | Retry behavior must be bounded and deterministic. |
| D7 | `dispatch_due(now, sender)` processes pending and due retry records once and returns the processed records; it must not poll or sleep. | The caller owns scheduling; the queue exposes a push-compatible primitive. |
| D8 | Delete unused `legacy_retry_delay`; preserve and update the called `format_delivery` helper. | Remove obsolete policy without breaking the CLI surface. |
| D9 | Remove the prototype `DeliveryService.mark_delivered` API and replace its old test with submit/dispatch coverage. | Dispatch state transitions are now the only delivery mutation path; retaining a second mutation API would split ownership. |
