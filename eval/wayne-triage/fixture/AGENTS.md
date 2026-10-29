# Triage fixture rules

- Read-only diagnosis only. Do not edit `src/`, `tests/`, `artifacts/`, `case.md`,
  or `tracker-state.json`.
- Do not call network, GitHub, Jira, or other tracker APIs. `case.md` is the full
  item when it contains tracker data.
- Triage may write only `triage/*.md` and, for a complete approved route,
  `checkpoints/handoff.md`, both under the project state directory that
  `/workspace/_shared/scripts/wayne-state-dir.sh` prints. Follow
  `/workspace/wayne-checkpoint/SKILL.md` and its packet template. The
  repository receives none of it.
- Do not implement, write a plan, commit, branch, push, or publish.
- User-visible output is concise Chinese; evidence files are English.
