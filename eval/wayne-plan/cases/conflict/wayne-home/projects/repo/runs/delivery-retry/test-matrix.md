# Delivery Retry Test Matrix

Owner: test-design

## E2E Verification Contract

| ID | Status | User path | Expected observable result |
|---|---|---|---|
| E1 | ⬜ | Submit the same request twice through `DeliveryService.submit`. | Both results expose the same delivery ID, the second says `created=false`, and the store contains one record. |
| E2 | ⬜ | Dispatch a delivery whose sender raises two transient failures and then succeeds at its due times. | Attempts progress 1→2→3, retry delays are 30 then 60 seconds, and final state is `delivered`. |
| E3 | ⬜ | Dispatch a delivery whose sender raises `PermanentDeliveryError`. | The delivery becomes `failed` after one attempt and is never returned by `list_due`. |
| E4 | ⬜ | Format a retry-wait delivery through `format_delivery`. | Output includes request ID, delivery ID, state, attempts, retry time, and redacted-safe last error without mutating the record. |

## U-SEED

| Seed | Behavior candidate |
|---|---|
| US1 | Reject blank request fields before state mutation. |
| US2 | Return the existing record for an identical request ID and payload. |
| US3 | Reject a reused request ID with different content. |
| US4 | Persist the request-id index and stable delivery ID in the store. |
| US5 | Increment attempts before sender invocation and schedule transient retries. |
| US6 | Stop retrying after the third transient failure. |
| US7 | Fail immediately on a permanent error. |
| US8 | Select only pending or due retry records. |
| US9 | Preserve the CLI formatter while deleting the unused delay helper. |
| US10 | Remove `mark_delivered` and replace its prototype test with submit/dispatch coverage. |
