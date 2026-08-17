# Report Export Test Matrix

## Unit / Integration Matrix

| ID | Owner | Scenario | Status |
|---|---|---|---|
| U1 | I1 | CSV output carries a header and two-decimal amounts | ☐ |
| U2 | I2 | JSON output is a compact array of normalized objects | ☐ |
| U3 | I1 | CSV normalizes whitespace and currency formatting in the name and amount | ☐ |
| U4 | I2 | JSON normalizes whitespace and currency formatting in the name and amount | ☐ |

## E2E Verification Contract

| ID | Env: entrypoint | Setup | Action | Observable outcome | Status |
|---|---|---|---|---|---|
| E1 | Runtime export API | A report with two rows | Render both formats | CSV and JSON agree on every normalized value | ⬜ |
