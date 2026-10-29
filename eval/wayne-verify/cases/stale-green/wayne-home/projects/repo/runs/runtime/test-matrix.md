# Runtime matrix

## E2E Verification Contract

| # | User path | Env: process | Env: data | Env: entrypoint | Observable (pass = ?) | Status |
|---|---|---|---|---|---|---|
| 1 | User converts the current beta input from the CLI | CLI invocation is the process | `data/input.txt` containing `beta` | `uv run --no-project python -m app data/input.txt output/result.txt` | stdout contains `CONVERT_OK value=BETA` and `output/result.txt` is freshly replaced with exactly `BETA` | ✅ |
