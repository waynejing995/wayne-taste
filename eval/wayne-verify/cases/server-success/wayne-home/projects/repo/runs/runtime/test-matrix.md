# Runtime matrix

## E2E Verification Contract

| # | User path | Env: process | Env: data | Env: entrypoint | Observable (pass = ?) | Status |
|---|---|---|---|---|---|---|
| 1 | User requests the converted value over HTTP | `uv run --no-project python server.py --data data/input.txt --ready run/ready --stopped run/stopped` (stdout/stderr in `run/server.log`) | `data/input.txt` containing `alpha` | `curl -fsS http://127.0.0.1:18765/convert` | response body is exactly `{"value":"ALPHA"}` | ⬜ |
