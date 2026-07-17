# Export command spec

- R1: user runs `tool export --format json` and receives `report.json` containing `{"ok":true}`.

## Existing E2E Verification Contract draft

| # | User path | Env: process | Env: data | Env: entrypoint | Observable (pass = ?) | Status |
|---|---|---|---|---|---|---|
| E-EXACT | User exports the report | `tool service --port 9000` | fixture `reports/demo.db` | `tool export --format json` | downloaded `report.json` contains exact JSON `{"ok":true}` | ⬜ |
