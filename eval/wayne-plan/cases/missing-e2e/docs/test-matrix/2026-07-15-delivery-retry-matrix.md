# Delivery Retry Test Matrix

Owner: test-design

The unit-level seed was drafted, but product has not approved an E2E contract.

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
