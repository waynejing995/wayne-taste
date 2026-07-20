# Idempotent Delivery Retry Design

Status: approved
Owner: product-design

Primary decision log: `docs/decisions/2026-07-15-delivery-retry-decisions.md`
Test matrix: `docs/test-matrix/2026-07-15-delivery-retry-matrix.md`

## Problem

The prototype creates a new random delivery for every submit and has no bounded
retry state. Callers cannot safely resume after a timeout or distinguish a
transient delivery failure from permanent failure.

## Requirements

- R1: A non-empty `request_id`, `destination`, and `body` are required.
- R2: Identical submissions with the same request ID are idempotent.
- R3: Conflicting content under an existing request ID fails visibly.
- R4: Stable delivery identity follows D2.
- R5: Transient failures use the exact bounded schedule in D6.
- R6: Permanent failures transition directly to `failed`.
- R7: Dispatch processes only pending or due records and never polls.
- R8: User-visible formatting exposes request ID, delivery ID, state, attempts,
  retry time, last error, destination, and a derived `delivered` boolean without
  changing state. The JSON retains the prototype's `destination` and `delivered`
  keys and adds the new fields; `delivered` is true only in state `delivered`.
- R9: Remove `DeliveryService.mark_delivered` and `legacy_retry_delay`; replace the
  prototype test while preserving `InMemoryDeliveryStore.all()` and `format_delivery`.

## Required interfaces

- `relay_queue.models.DeliveryRequest(request_id: str, destination: str, body: str)`
- `relay_queue.models.SubmitResult(delivery: Delivery, created: bool)`
- `relay_queue.models.Delivery` has `delivery_id`, `request_id`, `destination`,
  `body`, `state`, `attempts`, `retry_at`, and `last_error`. New records start as
  `pending` with zero attempts and no retry/error. Delivered and failed records
  clear `retry_at`.
- `relay_queue.service.DeliveryService.submit(request: DeliveryRequest) -> SubmitResult`
- `relay_queue.service.DeliveryService.dispatch_due(now: datetime, sender: Callable[[Delivery], None]) -> list[Delivery]`
- `relay_queue.store.InMemoryDeliveryStore.get_by_request_id(request_id: str) -> Delivery | None`
- `relay_queue.store.InMemoryDeliveryStore.list_due(now: datetime) -> list[Delivery]`
- `relay_queue.errors.IdempotencyConflict`, `relay_queue.errors.TransientDeliveryError`,
  and `relay_queue.errors.PermanentDeliveryError`

Store exception messages verbatim in `last_error`; evaluation messages contain no
secrets. `format_delivery` emits that stored message verbatim as JSON. Production
redaction policy is outside this in-memory fixture.

## Scope boundaries

- In scope: in-memory state, deterministic IDs, bounded retry transitions,
  injected sender, formatting, unit and integration tests.
- Out of scope: database persistence, async workers, polling loops, network
  clients, schema migrations, backoff configuration, and concurrent dispatch.
