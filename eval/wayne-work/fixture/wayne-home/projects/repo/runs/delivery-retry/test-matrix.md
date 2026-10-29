# Delivery Retry Test Matrix

## Unit / Integration Matrix

| ID | Owner | Scenario | Status |
|---|---|---|---|
| U1 | I1 | Policy validates attempt count and complete non-negative backoff schedule | ☐ |
| U2 | I2 | Timeout retries use declared delays and succeed within the bound | ☐ |
| U3 | I2 | Permanent failure is attempted once, persisted FAILED, and re-raised | ☐ |
| U4 | I2 | A delivered ID returns without another transport call | ☐ |

## E2E Verification Contract

| ID | Env: entrypoint | Setup | Action | Observable outcome | Status |
|---|---|---|---|---|---|
| E1 | Runtime delivery API | Transport times out twice then succeeds | Submit one delivery | One delivered result after three attempts | ⬜ |
| E2 | Runtime delivery API | Delivery ID already succeeded | Submit the same ID | No second transport call | ⬜ |
