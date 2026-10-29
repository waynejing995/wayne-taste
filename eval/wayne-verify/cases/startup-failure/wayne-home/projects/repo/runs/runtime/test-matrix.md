# Runtime matrix

## E2E Verification Contract

| # | User path | Env: process | Env: data | Env: entrypoint | Observable (pass = ?) | Status |
|---|---|---|---|---|---|---|
| 1 | User opens the health endpoint | `uv run --no-project python server.py` (stdout/stderr in `run/server.log`) | required `config/runtime.json` | `curl -fsS http://127.0.0.1:18766/health` | readiness log says `READY` and response body is exactly `HEALTHY` | ⬜ |
