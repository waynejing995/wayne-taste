# Queued Webhook Delivery Decisions

Status: in-progress
Decision lock: locked
Design-section approval: pending

| # | Question | Decision | Rationale | Source |
|---|---|---|---|---|
| 1 | Delivery topology | Use the existing queue | Decouple request and delivery failures | user |
| 2 | Delivery guarantee | At-least-once; Dispatcher owns idempotency | Preserve one lifecycle owner | user |
| 3 | Retry policy | Five bounded attempts with exponential backoff and jitter | Bound recovery load | user |
| 4 | Exhaustion | Mark FAILED and retain payload for operator replay | Preserve evidence and recovery | user |

## Decision DAG

| Node | Parent | Kind | Decision | Status | Opens when |
|---|---|---|---|---|---|
| N1 | root | choice | Delivery topology | resolved | start |
| N2 | N1 | choice | Delivery guarantee and idempotency ownership | resolved | N1 resolved |
| N3 | N2 | choice | Retry policy and attempt budget | resolved | N2 resolved |
| N4 | N3 | choice | Exhaustion behavior and operator recovery | resolved | N3 resolved |
