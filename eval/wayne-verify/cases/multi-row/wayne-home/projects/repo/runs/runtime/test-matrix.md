# Runtime matrix

## E2E Verification Contract

| # | User path | Env: process | Env: data | Env: entrypoint | Observable (pass = ?) | Status |
|---|---|---|---|---|---|---|
| 1 | User runs the first CLI mode | CLI invocation is the process | mode `fail` | `uv run --no-project python -m app fail` | stdout is exactly `FIRST_OK` | ⬜ |
| 2 | User runs the second CLI mode | CLI invocation is the process | mode `pass` | `uv run --no-project python -m app pass` | stdout is exactly `SECOND_OK` | ⬜ |
