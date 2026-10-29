# Runtime matrix

## Unit-integration layer

| U# | Behavior | Status |
|---|---|---|
| U1 | converter uppercases input | ☑ |

## E2E Verification Contract

| # | User path | Env: process | Env: data | Env: entrypoint | Observable (pass = ?) | Status |
|---|---|---|---|---|---|---|
| 1 | User converts the supplied file from the CLI | CLI invocation is the process | `data/input.txt` containing `alpha` | `uv run --no-project python -m app data/input.txt output/result.txt` | stdout contains `CONVERT_OK value=ALPHA` and `output/result.txt` contains exactly `ALPHA` | ⬜ |
