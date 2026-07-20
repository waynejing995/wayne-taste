# Idempotent Delivery Retry Implementation Plan

## Overview

Replace the prototype's random, one-shot delivery flow with an in-memory,
idempotent submission contract and a bounded, caller-driven retry state machine.
The implementation keeps delivery records and the request-ID index in
InMemoryDeliveryStore, exposes created-versus-existing submission results, and
updates the existing JSON formatter without introducing polling, workers, network
clients, persistence, or configurable backoff.

The approved decision log, design, and test matrix are complete. The active metrics
export plan is compatible because this plan preserves InMemoryDeliveryStore.all().

## Problem Frame

The prototype creates a fresh UUID for every call to DeliveryService.submit, stores
only a delivered boolean, and relies on a second mark_delivered mutation API. It
cannot identify a retried request, reject conflicting reuse of a request ID, expose
retry timing, or distinguish transient and permanent sender failures.

Success means:

- the same request ID and payload resolve to one stable delivery record;
- conflicting content fails before the existing record is changed;
- dispatch performs one pass over pending and due records;
- attempts and state transitions follow the approved 30-second, 60-second, then
  terminal-failure schedule;
- the formatter derives delivered from state and exposes the complete observable
  record without mutating it;
- obsolete mutation and retry-policy surfaces are removed while the active
  metrics-plan dependency remains intact.

## Requirements Trace

| Requirement | Owning units |
|---|---|
| R1 | I1 |
| R2 | I2, I3 |
| R3 | I3 |
| R4 | I3 |
| R5 | I1, I4 |
| R6 | I1, I4 |
| R7 | I2, I4 |
| R8 | I1, I5 |
| R9 | I2, I5 |

## Scope Boundaries

In scope:

- in-memory delivery records and a store-owned request-ID index;
- deterministic delivery IDs derived from request IDs;
- request validation, duplicate detection, and visible idempotency conflicts;
- pending, retry_wait, delivered, and failed state transitions;
- fixed 30-second and 60-second transient retry delays;
- caller-injected synchronous senders and one-pass due dispatch;
- JSON formatting and focused unit/integration coverage.

Out of scope:

- database or filesystem persistence;
- async workers, timers, schedulers, polling, and sleeping;
- network clients and Retry-After processing;
- schema migrations and backoff configuration;
- concurrent dispatch and collision policy beyond the approved 12-character hash;
- production error-message redaction.

No dependency or packaging change is required.

## Context

The source gate resolved to the approved decision log first, then the approved
design, its referenced test matrix, the active metrics plan, current code/tests,
and the two local lessons. The Retry-After lesson does not apply because there is
no network client. The retry-state-owner lesson reinforces D1: the store owns both
record storage and request-ID lookup state.

~~~mermaid
flowchart TD
    A[Approved decisions, design, matrix, code, plans, lessons] --> B{Active plan conflict?}
    B -- yes --> C[PLAN_CONFLICT: stop]
    B -- no --> D{Valid E2E contract present?}
    D -- no --> E[MISSING_E2E: stop]
    D -- yes --> F[Draft dependency-ordered implementation units]
    F --> G{Trace, interface, symbol, and scope audit passes?}
    G -- no --> H[Revise the plan]
    H --> F
    G -- yes --> I[Plan ready for implementation]
~~~

For this repository, B resolved to no, D resolved to yes with E1 through E4, and
the final audit must resolve G to yes before implementation begins.

## Key Technical Decisions

| Decision | Plan realization |
|---|---|
| D1 | InMemoryDeliveryStore owns both the delivery dictionary and request-ID-to-delivery-ID index; the service uses store APIs instead of keeping a second map. |
| D2 | DeliveryService.submit computes sha256(request.request_id.encode()).hexdigest()[:12] exactly. |
| D3 | submit returns the stored delivery for exact destination/body equality and raises IdempotencyConflict for either mismatch before any save. |
| D4 | DeliveryRequest, Delivery, and SubmitResult are explicit dataclasses; submit accepts one DeliveryRequest and returns one SubmitResult. |
| D5 | Delivery stores the four approved states, attempts, retry_at, and last_error; dispatch increments attempts before calling sender. |
| D6 | Transient attempts one and two schedule from the supplied now at 30 and 60 seconds; a third transient failure becomes failed; a permanent failure becomes failed immediately. |
| D7 | dispatch_due obtains one list_due snapshot, processes each selected record once, returns that processed list, and contains no loop that waits for future work. |
| D8 | legacy_retry_delay is deleted; format_delivery remains at the same module/function surface and is updated. |
| D9 | mark_delivered and its only caller test are deleted; submit/dispatch integration coverage becomes the supported mutation path. |

Implementation details fixed by the approved interfaces:

- DeliveryRequest rejects empty or whitespace-only request_id, destination, or
  body with ValueError while retaining the original nonblank strings unchanged.
- State is represented by the approved string values rather than a second boolean
  source of truth.
- retry_at is datetime or None. The formatter emits retry_at.isoformat() when set
  and null otherwise.
- Sender exception text is stored with str(exception) and emitted unchanged.
- Unexpected sender exceptions propagate. They are not converted into transient
  or permanent outcomes.
- Successful dispatch sets state to delivered and clears retry_at. It retains the
  most recent last_error, if any, as the historical last sender error; the design
  requires retry_at, not last_error, to clear at a terminal state.

## Open Questions

None. Product-design approved D1 through D9 and R1 through R9, test-design supplied
E1 through E4 and US1 through US10, and the active metrics plan requires only the
explicitly preserved InMemoryDeliveryStore.all() surface.

## File Structure

| Path | Change |
|---|---|
| src/relay_queue/errors.py | Add the three domain exception classes. |
| src/relay_queue/models.py | Replace the prototype shape with validated request, delivery-state, and submit-result dataclasses. |
| src/relay_queue/store.py | Add the request-ID index and due-record query while preserving all(). |
| src/relay_queue/service.py | Implement idempotent submit and one-pass dispatch, then remove prototype mutation/policy code. |
| src/relay_queue/cli.py | Expand the existing JSON formatter and derive delivered from state. |
| tests/test_service.py | Replace the prototype test with unit and integration scenarios for every seeded behavior. |

## Implementation Units

### Unit I1 — Define validated delivery data and domain errors

#### Goal

Establish the single data shape used by the store, service, sender, and formatter,
including request validation and all observable retry fields.

#### Requirements

- R1
- R5
- R6
- R8

#### Dependencies

none — first unit has no implementation dependency.

#### Consumes

- existing src/relay_queue/models.py::Delivery — prototype record shape being replaced

#### Produces

- src/relay_queue/models.py::DeliveryRequest
- src/relay_queue/models.py::Delivery
- src/relay_queue/models.py::SubmitResult
- src/relay_queue/errors.py::IdempotencyConflict
- src/relay_queue/errors.py::TransientDeliveryError
- src/relay_queue/errors.py::PermanentDeliveryError
- tests/test_service.py::test_delivery_request_rejects_blank_fields

#### Files

- src/relay_queue/models.py::DeliveryRequest — new: dataclass with request_id, destination, body, and whitespace-aware nonblank validation
- src/relay_queue/models.py::Delivery — modify: replace delivered with request_id, state, attempts, retry_at, and last_error while retaining delivery_id, destination, and body
- src/relay_queue/models.py::SubmitResult — new: dataclass containing delivery and created
- src/relay_queue/errors.py::IdempotencyConflict — new: domain exception for conflicting request-ID reuse
- src/relay_queue/errors.py::TransientDeliveryError — new: sender exception that activates bounded retry
- src/relay_queue/errors.py::PermanentDeliveryError — new: sender exception that activates immediate failure
- tests/test_service.py::test_delivery_request_rejects_blank_fields — new: parameterized validation coverage for each required field

#### Approach

1. Add errors.py with three thin Exception subclasses and no retry policy.
2. Add DeliveryRequest as a dataclass. In __post_init__, inspect request_id,
   destination, and body independently with value.strip(); raise ValueError naming
   the blank field before any store or service can observe the request. Do not
   normalize accepted values.
3. Replace Delivery.delivered with request_id, state, attempts, retry_at, and
   last_error. Keep delivery_id, destination, and body. Defaults are state
   pending, attempts 0, retry_at None, and last_error None.
4. Constrain the state annotation to the four approved literal strings so the
   stored state remains the only source used to derive delivered.
5. Add SubmitResult with delivery and created fields.
6. Add the focused request-validation test without altering the prototype test;
   Unit I5 removes and replaces that test after the supported flow exists.

#### Technical design

none — Approach fully defines the directional design.

#### Patterns

- Follow the existing dataclass style in src/relay_queue/models.py.
- Keep retry behavior out of the model; models define state shape and invariants.
- Use standard exceptions for field validation and named domain exceptions for
  delivery-control outcomes.

#### Test scenarios

- U1 — construct requests with an empty or whitespace-only request_id,
  destination, or body and assert ValueError occurs before any store call.

#### E rows

- E1 — supplies the request and result shapes used by duplicate submission.
- E4 — supplies every retry-wait field consumed by the formatter.

#### Verification

- uv run pytest tests/test_service.py -k test_delivery_request_rejects_blank_fields

#### Decision trace

- D4 defines DeliveryRequest and SubmitResult.
- D5 defines the state and attempt fields.
- D6 requires fields capable of representing retry wait and terminal failure.

### Unit I2 — Make the store the sole state/index owner

#### Goal

Extend InMemoryDeliveryStore with a request-ID index and a pure due-record query
while preserving its active-plan-compatible all() view.

#### Requirements

- R2
- R7
- R9

#### Dependencies

- I1

#### Consumes

- existing src/relay_queue/store.py::InMemoryDeliveryStore — prototype store to extend
- existing src/relay_queue/store.py::InMemoryDeliveryStore.all — active metrics-plan dependency to preserve
- from I1 src/relay_queue/models.py::Delivery

#### Produces

- src/relay_queue/store.py::InMemoryDeliveryStore.__init__
- src/relay_queue/store.py::InMemoryDeliveryStore.save
- src/relay_queue/store.py::InMemoryDeliveryStore.get_by_request_id
- src/relay_queue/store.py::InMemoryDeliveryStore.list_due
- tests/test_service.py::test_list_due_selects_pending_and_due_records

#### Files

- src/relay_queue/store.py::InMemoryDeliveryStore.__init__ — modify: initialize the delivery dictionary and request-ID-to-delivery-ID index
- src/relay_queue/store.py::InMemoryDeliveryStore.save — modify: persist a delivery and update its request-ID index entry in the same owner
- src/relay_queue/store.py::InMemoryDeliveryStore.get_by_request_id — new: resolve the index to the current delivery or return None
- src/relay_queue/store.py::InMemoryDeliveryStore.list_due — new: return pending records and retry_wait records whose retry_at is at or before now
- tests/test_service.py::test_list_due_selects_pending_and_due_records — new: direct selection coverage across all states and retry times

#### Approach

1. Keep _records keyed by delivery_id and add _request_ids keyed by request_id with
   delivery_id values. Do not expose or duplicate this map in DeliveryService.
2. Update save so a single call writes the record and its request-ID index entry.
   Existing records are replaced under the same deterministic delivery ID during
   state transitions.
3. Implement get_by_request_id by resolving _request_ids first and then _records;
   return None when the request ID is absent.
4. Implement list_due as a snapshot comprehension over insertion-ordered records.
   Include every pending record. Include a retry_wait record only when retry_at is
   not None and retry_at <= now. Exclude delivered, failed, and future retry_wait
   records.
5. Leave all() behavior and return shape unchanged for the active metrics plan.

#### Technical design

none — Approach fully defines the directional design.

#### Patterns

- Apply knowledge/retry-state-owner.md: records and their identity index share one
  store owner and one save path.
- Match the existing in-memory dictionary and list-returning API style.
- Keep list_due side-effect free; scheduling remains a caller/service concern.

#### Test scenarios

- U8 — seed pending, past-due retry_wait, exactly-due retry_wait, future
  retry_wait, delivered, and failed records; call list_due(now); assert only
  pending and due retry records are returned and no record changes.

#### E rows

- E1 — provides the one-record store view used after duplicate submission.
- E2 — exposes pending and due transient records to each dispatch call.
- E3 — excludes the terminal failed record from subsequent work.

#### Verification

- uv run pytest tests/test_service.py -k test_list_due_selects_pending_and_due_records

#### Decision trace

- D1 assigns records and the request-ID index to the store.
- D7 requires a due-record selection primitive with no polling.
- D9 and the active metrics plan require all() to remain available.

### Unit I3 — Implement idempotent submission and stable identity

#### Goal

Replace random two-argument submission with the approved DeliveryRequest to
SubmitResult contract, including exact duplicate and conflict branches.

#### Requirements

- R2
- R3
- R4

#### Dependencies

- I1
- I2

#### Consumes

- existing src/relay_queue/service.py::DeliveryService — service class whose submit contract changes
- from I1 src/relay_queue/models.py::DeliveryRequest
- from I1 src/relay_queue/models.py::Delivery
- from I1 src/relay_queue/models.py::SubmitResult
- from I1 src/relay_queue/errors.py::IdempotencyConflict
- from I2 src/relay_queue/store.py::InMemoryDeliveryStore.get_by_request_id
- from I2 src/relay_queue/store.py::InMemoryDeliveryStore.save

#### Produces

- src/relay_queue/service.py::DeliveryService.submit
- tests/test_service.py::test_submit_returns_existing_for_identical_request
- tests/test_service.py::test_submit_rejects_idempotency_conflict
- tests/test_service.py::test_submit_uses_stable_delivery_id_and_store_index

#### Files

- src/relay_queue/service.py::DeliveryService.submit — modify: accept DeliveryRequest and return created/existing SubmitResult with deterministic identity
- tests/test_service.py::test_submit_returns_existing_for_identical_request — new: duplicate submission and single-record assertions
- tests/test_service.py::test_submit_rejects_idempotency_conflict — new: destination and body mismatch branches with immutability assertions
- tests/test_service.py::test_submit_uses_stable_delivery_id_and_store_index — new: exact hash, initial state, and indexed lookup assertions

#### Approach

1. Change submit to accept one already-validated DeliveryRequest.
2. Query get_by_request_id before constructing or saving a record.
3. If a record exists and both destination and body equal the request exactly,
   return SubmitResult(existing, False) without calling save.
4. If either field differs, raise IdempotencyConflict with the request ID in the
   message and leave the existing record/index unchanged.
5. If no record exists, compute
   sha256(request.request_id.encode()).hexdigest()[:12], construct Delivery with
   the request fields and I1 defaults, save it once, and return
   SubmitResult(delivery, True).
6. Remove the uuid4 dependency from service.py when its final caller is replaced.

#### Technical design

none — Approach fully defines the directional design.

#### Patterns

- Query and mutate through the store APIs established in I2; never introduce a
  service-owned idempotency cache.
- Compare original destination/body strings because I1 validates without
  normalizing accepted content.
- Perform every conflict check before save to keep failure atomic in this
  single-threaded in-memory scope.

#### Test scenarios

- U2 — submit one request twice; assert object identity/stable delivery ID,
  created true then false, and one stored record.
- U3 — reuse a request ID with a changed destination and then with a changed body;
  assert IdempotencyConflict and unchanged stored content/count in both branches.
- U4 — submit a new request; assert the exact 12-character SHA-256 delivery ID,
  initial pending fields, and get_by_request_id returning that stored record.

#### E rows

- E1 — completes both duplicate-submission branches and the observable created flag.

#### Verification

- uv run pytest tests/test_service.py -k "test_submit_returns_existing_for_identical_request or test_submit_rejects_idempotency_conflict or test_submit_uses_stable_delivery_id_and_store_index"

#### Decision trace

- D1 keeps idempotency state behind store APIs.
- D2 fixes the exact delivery-ID formula.
- D3 fixes the identical and conflicting reuse branches.
- D4 fixes submit input/output types and created semantics.

### Unit I4 — Implement one-pass bounded dispatch

#### Goal

Add deterministic dispatch of currently actionable records with exact attempt,
retry, success, and terminal-failure transitions.

#### Requirements

- R5
- R6
- R7

#### Dependencies

- I1
- I2
- I3

#### Consumes

- from I1 src/relay_queue/models.py::Delivery
- from I1 src/relay_queue/errors.py::TransientDeliveryError
- from I1 src/relay_queue/errors.py::PermanentDeliveryError
- from I2 src/relay_queue/store.py::InMemoryDeliveryStore.list_due
- from I2 src/relay_queue/store.py::InMemoryDeliveryStore.save
- from I3 src/relay_queue/service.py::DeliveryService.submit

#### Produces

- src/relay_queue/service.py::DeliveryService.dispatch_due
- tests/test_service.py::test_dispatch_schedules_transient_retries_before_success
- tests/test_service.py::test_dispatch_stops_after_third_transient_failure
- tests/test_service.py::test_dispatch_fails_immediately_on_permanent_error

#### Files

- src/relay_queue/service.py::DeliveryService.dispatch_due — new: one-pass sender dispatch with fixed retry and terminal state branches
- tests/test_service.py::test_dispatch_schedules_transient_retries_before_success — new: attempts one through three and 30/60-second due-time progression
- tests/test_service.py::test_dispatch_stops_after_third_transient_failure — new: third transient failure terminal branch
- tests/test_service.py::test_dispatch_fails_immediately_on_permanent_error — new: first-attempt permanent failure and due-list exclusion

#### Approach

1. Call store.list_due(now) once and retain that snapshot as processed.
2. For each record in snapshot order, increment attempts before invoking
   sender(delivery). Do not fetch the record again or process it twice.
3. On success, set state to delivered and retry_at to None, then save. Keep
   last_error unchanged so it remains the most recent sender error, if one
   occurred on an earlier attempt.
4. On TransientDeliveryError, store str(exception) in last_error. When attempts is
   1, set state retry_wait and retry_at to now + 30 seconds. When attempts is 2,
   use now + 60 seconds. When attempts is 3, set state failed and retry_at None.
5. On PermanentDeliveryError, store str(exception), set state failed, clear
   retry_at, and save regardless of the current attempt number.
6. Allow every other exception to propagate so unsupported sender behavior is
   visible. No broad catch converts it into a domain outcome.
7. Return the original processed snapshot after all selected records complete
   their success or approved failure branch. Do not sleep, rescan, or wait for a
   future retry time.

#### Technical design

none — Approach fully defines the directional design.

#### Patterns

- Use datetime.timedelta at the service policy boundary; do not place fixed
  delays in the model, store, or a replacement legacy helper.
- Preserve push-compatible scheduling: the caller supplies now and calls again
  when work is due.
- Save after each approved transition through the store owner.

#### Test scenarios

- U5 — use a sender that fails transiently twice and then succeeds; dispatch at
  t0, t0+30s, and t0+90s; assert attempts increment before each sender call,
  retry_at advances by 30 then 60 seconds, and final state is delivered.
- U6 — use an always-transient sender across three due dispatches; assert the
  third failure sets failed, clears retry_at, and prevents later selection.
- U7 — use a permanently failing sender for a pending record; assert one attempt,
  verbatim last_error, failed state, cleared retry_at, and no later due result.

#### E rows

- E2 — completes the two-transient-then-success path at the approved due times.
- E3 — completes immediate permanent failure and due-list exclusion.

#### Verification

- uv run pytest tests/test_service.py -k "test_dispatch_schedules_transient_retries_before_success or test_dispatch_stops_after_third_transient_failure or test_dispatch_fails_immediately_on_permanent_error"

#### Decision trace

- D5 fixes state names and pre-sender attempt increments.
- D6 fixes both transient delays and terminal failure branches.
- D7 fixes one-pass processing, return value, and absence of polling.

### Unit I5 — Update observability and remove prototype mutation paths

#### Goal

Preserve the formatter's public surface with the expanded state projection, remove
obsolete APIs and their now-dead support, and close the full user-path tests.

#### Requirements

- R8
- R9

#### Dependencies

- I1
- I2
- I3
- I4

#### Consumes

- existing src/relay_queue/cli.py::format_delivery — called formatter surface to preserve
- existing src/relay_queue/service.py::DeliveryService.mark_delivered — prototype mutation API to remove
- existing src/relay_queue/service.py::legacy_retry_delay — unused policy helper to remove
- existing src/relay_queue/store.py::InMemoryDeliveryStore.get — becomes unused after mark_delivered removal
- existing tests/test_service.py::test_submit_and_mark_delivered — prototype caller test to replace
- from I1 src/relay_queue/models.py::Delivery
- from I3 src/relay_queue/service.py::DeliveryService.submit
- from I4 src/relay_queue/service.py::DeliveryService.dispatch_due

#### Produces

- src/relay_queue/cli.py::format_delivery
- tests/test_service.py::test_format_delivery_projects_retry_state_without_mutation
- tests/test_service.py::test_submit_and_dispatch_replaces_mark_delivered

#### Files

- src/relay_queue/cli.py::format_delivery — modify: emit request ID, delivery ID, state, attempts, retry time, last error, destination, and derived delivered
- src/relay_queue/service.py::DeliveryService.mark_delivered — delete: dispatch transitions are the approved sole mutation path
- src/relay_queue/service.py::legacy_retry_delay — delete: approved delays live only in dispatch_due and the helper has no caller
- src/relay_queue/store.py::InMemoryDeliveryStore.get — delete: its only caller mark_delivered is removed and it is not a required or active-plan surface
- tests/test_service.py::test_submit_and_mark_delivered — delete: it exercises the removed prototype contract
- tests/test_service.py::test_format_delivery_projects_retry_state_without_mutation — new: exact retry-wait JSON projection and before/after record equality
- tests/test_service.py::test_submit_and_dispatch_replaces_mark_delivered — new: supported submit then successful dispatch integration path and removed-symbol assertions

#### Approach

1. Keep format_delivery in relay_queue.cli and retain sorted-key JSON output.
2. Emit exactly request_id, delivery_id, state, attempts, retry_at, last_error,
   destination, and delivered. Compute delivered as
   delivery.state == "delivered"; do not store or assign it.
3. Serialize retry_at with isoformat() when present and None to JSON null when
   absent. Emit last_error unchanged; the fixture contract guarantees safe test
   messages and excludes production redaction policy.
4. Snapshot the Delivery fields before formatting in the test and compare them
   afterward to prove the projection has no mutation.
5. Delete mark_delivered and legacy_retry_delay. Remove InMemoryDeliveryStore.get
   after confirming its only repository caller was mark_delivered; retain
   get_by_request_id and all().
6. Delete the prototype test. Add an integration test that submits a
   DeliveryRequest, dispatches it with a successful injected sender, and observes
   delivered state and formatter output without a second mutation API.
7. Assert mark_delivered is absent from DeliveryService and legacy_retry_delay is
   absent from relay_queue.service so cleanup cannot regress silently.

#### Technical design

none — Approach fully defines the directional design.

#### Patterns

- Follow the existing json.dumps(..., sort_keys=True) formatter shape.
- Derive views from the state owner rather than writing a second delivered flag.
- Delete only caller-proven dead surfaces; preserve called format_delivery and the
  active metrics plan's all() dependency.

#### Test scenarios

- U9 — format a retry_wait delivery with a safe exception message; assert every
  required key/value, ISO retry time, verbatim last_error, derived false
  delivered value, stable sorted JSON, and unchanged record; assert the unused
  delay helper is absent.
- U10 — submit and successfully dispatch a new request; assert final delivered
  state and formatter projection, and assert mark_delivered and its prototype
  test surface no longer exist.

#### E rows

- E1 — verifies duplicate submit behavior remains intact after cleanup.
- E2 — verifies transient retry integration remains intact after cleanup.
- E3 — verifies permanent failure remains terminal after cleanup.
- E4 — completes the formatter projection and non-mutation user path.

#### Verification

- uv run pytest

#### Decision trace

- D5 makes state, not a stored boolean, the observable source of truth.
- D8 requires deletion of legacy_retry_delay and preservation/update of format_delivery.
- D9 requires deletion of mark_delivered and replacement of its caller test.

## Test Matrix

| ID | Status | User path | Expected observable result |
|---|---|---|---|
| E1 | ⬜ | Submit the same request twice through `DeliveryService.submit`. | Both results expose the same delivery ID, the second says `created=false`, and the store contains one record. |
| E2 | ⬜ | Dispatch a delivery whose sender raises two transient failures and then succeeds at its due times. | Attempts progress 1→2→3, retry delays are 30 then 60 seconds, and final state is `delivered`. |
| E3 | ⬜ | Dispatch a delivery whose sender raises `PermanentDeliveryError`. | The delivery becomes `failed` after one attempt and is never returned by `list_due`. |
| E4 | ⬜ | Format a retry-wait delivery through `format_delivery`. | Output includes request ID, delivery ID, state, attempts, retry time, and redacted-safe last error without mutating the record. |

### Unit and Integration Matrix

| ID | Owner | Seed | Surface | Scenario | Status |
|---|---|---|---|---|---|
| U1 | I1 | US1 | src/relay_queue/models.py::DeliveryRequest | Empty or whitespace-only request_id, destination, and body values → construct each request → ValueError is raised before a store can mutate | ☐ |
| U2 | I3 | US2 | src/relay_queue/service.py::DeliveryService.submit | One valid request followed by an identical request → submit both → the same stored delivery returns with created true then false and store size one | ☐ |
| U3 | I3 | US3 | src/relay_queue/service.py::DeliveryService.submit | Existing request ID with changed destination or body → submit conflicting request → IdempotencyConflict is raised and stored content/count remain unchanged | ☐ |
| U4 | I3 | US4 | src/relay_queue/service.py::DeliveryService.submit | New request with known request ID → submit and query store index → delivery ID equals the approved 12-character SHA-256 value and indexed record is identical | ☐ |
| U5 | I4 | US5 | src/relay_queue/service.py::DeliveryService.dispatch_due | Sender fails transiently at attempts one and two then succeeds → dispatch at each due time → attempts increment before calls, delays are 30 then 60 seconds, and state becomes delivered | ☐ |
| U6 | I4 | US6 | src/relay_queue/service.py::DeliveryService.dispatch_due | Sender fails transiently three times → dispatch at all three due times → third failure sets failed with no retry time and no later due selection | ☐ |
| U7 | I4 | US7 | src/relay_queue/service.py::DeliveryService.dispatch_due | Pending delivery with permanently failing sender → dispatch once → attempts is one, state is failed, retry time is clear, and exception text is stored verbatim | ☐ |
| U8 | I2 | US8 | src/relay_queue/store.py::InMemoryDeliveryStore.list_due | Mixed pending, due, future, delivered, and failed records → call list_due at fixed now → only pending and due retry records return without mutation | ☐ |
| U9 | I5 | US9 | src/relay_queue/cli.py::format_delivery | Retry-wait delivery with safe last error → format and compare record snapshots → complete sorted JSON is returned, delivered is false, and record is unchanged while obsolete delay code is absent | ☐ |
| U10 | I5 | US10 | tests/test_service.py::test_submit_and_dispatch_replaces_mark_delivered | Fresh service and successful sender → submit then dispatch through supported APIs → delivery is delivered and prototype mutation/helper/test surfaces are absent | ☐ |

### Dropped Seeds

| Seed | Reason |
|---|---|

## Dead Code / Legacy Cleanup

- Delivery.delivered is not unused today: format_delivery and the prototype test
  call it. I1 replaces it with state because R8 explicitly makes delivered a
  derived view; I5 updates both callers before the old field is considered gone.
- uuid4 is called by the prototype submit implementation. I3 removes its import
  only when deterministic hashing replaces that call.
- legacy_retry_delay has no caller in source or tests and D8 explicitly requires
  deletion.
- DeliveryService.mark_delivered is called by
  test_submit_and_mark_delivered. D9 explicitly removes both the API and that test
  in favor of dispatch state transitions.
- InMemoryDeliveryStore.get becomes caller-free when mark_delivered is deleted. It
  is not listed among required interfaces or preservation constraints, so I5
  deletes it rather than retaining a speculative lookup path.
- format_delivery has a test caller and is an R9 compatibility surface; it is
  updated in place, not renamed or deleted.
- InMemoryDeliveryStore.all() is required by both R9 and the active metrics plan;
  it remains unchanged and covered by E1.

## System-Wide Impact

| Area | Impact |
|---|---|
| State ownership | Store remains the sole owner of records and request-ID index; service owns transition behavior but no duplicate state map. |
| Public Python API | submit changes to DeliveryRequest → SubmitResult; dispatch_due is added; mark_delivered is intentionally removed. |
| Data model | delivered storage is replaced by explicit state, attempt, retry, and error fields; formatter keeps a derived delivered key. |
| Scheduling | Callers invoke dispatch_due with now; the library never sleeps or polls. |
| CLI/JSON | destination and delivered remain; request ID, state, attempts, retry time, and last error become observable. |
| Metrics plan | No conflict: all() remains a read-only reconstructible view over store-owned records. |
| Dependencies | hashlib, datetime, dataclasses, json, and typing are standard-library only; pyproject.toml is unchanged. |
| Persistence/concurrency | Behavior remains process-local and single-threaded; no persistence or concurrent claim semantics are introduced. |

## Risks & Dependencies

- The 12-character SHA-256 prefix has a theoretical collision risk. D2 fixes that
  identity contract, so this implementation does not add an unapproved collision
  policy.
- datetime comparison requires caller-provided now and stored retry_at values to
  use compatible naive/aware forms. Tests use one fixed datetime family; timezone
  normalization is outside the approved scope.
- Mutable in-memory Delivery objects make transitions immediately observable.
  All approved branches still call save so record and request-index ownership stay
  centralized.
- Unexpected sender exceptions propagate after attempts has incremented, matching
  the fail-loud boundary. Only the two approved domain exceptions produce managed
  failure transitions.
- last_error is emitted verbatim by explicit design. Tests use safe messages;
  production redaction remains out of scope.
- Removing mark_delivered and get is intentionally incompatible with prototype
  callers, but D9 approves the mutation-path removal and repository search found
  only the replaced prototype test.
- Implementation depends only on Python 3.11 standard-library behavior and the
  existing pytest development dependency.

## Sources & References

- AGENTS.md
- docs/decisions/2026-07-15-delivery-retry-decisions.md
- docs/specs/2026-07-15-delivery-retry-design.md
- docs/test-matrix/2026-07-15-delivery-retry-matrix.md
- docs/plans/2026-07-10-metrics-export-plan.md
- knowledge/retry-state-owner.md
- knowledge/http-retry-after.md
- src/relay_queue/models.py
- src/relay_queue/store.py
- src/relay_queue/service.py
- src/relay_queue/cli.py
- tests/test_service.py
- pyproject.toml
