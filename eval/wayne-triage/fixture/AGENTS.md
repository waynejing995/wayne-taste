# Triage fixture rules

- Read-only diagnosis only. Do not edit `src/`, `tests/`, `artifacts/`, `case.md`,
  or `tracker-state.json`.
- Do not call network, GitHub, Jira, or other tracker APIs. `case.md` is the full
  item when it contains tracker data.
- Triage may write only `.wayne/triage/*.md` and, for a complete approved route,
  `.wayne/checkpoints/handoff.md` following `/workspace/support/checkpoint.md`.
- Do not implement, write a plan, commit, branch, push, or publish.
- User-visible output is concise Chinese; evidence files are English.
