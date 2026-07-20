# Decision Log: Retry Exhaustion

Status: in-progress

| # | Question | Decision | Rationale | Source |
|---|---|---|---|---|
| 1 | Delivery lifecycle owner | Dispatcher | Preserve one state owner | codebase |
| 2 | Retryable failures | Transport timeout and HTTP 429/503 only | Permanent failures must fail loud | user |
| 3 | Attempt budget | Three total attempts | Bound recovery load | user |

## Decision DAG

| Node | Parent | Kind | Decision | Status | Opens when |
|---|---|---|---|---|---|
| N1 | root | fact | Dispatcher owns the delivery lifecycle | resolved | repository evidence |
| N2 | N1 | choice | Retryable failure classes | resolved | N1 resolved |
| N3 | N2 | choice | Attempt budget | resolved | N2 resolved |
| N4 | N3 | choice | Exhaustion policy and operator recovery | open | N3 resolved |
