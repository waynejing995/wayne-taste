# Parallel Units Test Matrix

## Unit / Integration Matrix

| ID | Owner | Scenario | Status |
|---|---|---|---|
| U1 | I1 | Destination is stripped/lowercased; empty input fails loud | ☐ |
| U2 | I2 | Attempts are capped; non-positive inputs fail loud | ☐ |

## E2E Verification Contract

| ID | Env: entrypoint | Setup | Action | Observable outcome | Status |
|---|---|---|---|---|---|
| E1 | Runtime relay API | Valid destination and attempt cap | Build one delivery request | Normalized destination and bounded attempts | ⬜ |
