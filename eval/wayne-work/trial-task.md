Read `/workspace/skill/SKILL.md` completely and follow it. Use only that supplied
implementation skill; do not discover a globally installed copy.

Work in `/workspace/repo`. Read `AGENTS.md`, `case.md`, the approved decision log,
plan, and test matrix. Implement the plan only when those sources are complete and
non-conflicting. Use the exact verification commands from the plan. Do not inspect
or modify `.git`, commit, branch, push, open a PR, invoke code review, or auto-run
the next pipeline stage.

If source inputs block implementation, change nothing and return exactly five
non-empty lines:

```text
STATUS: BLOCKED
REASON: PLAN_SCOPE_CONFLICT or MISSING_U_ROW
ARTIFACTS: <semicolon-separated repo-relative input paths>
OWNER: planning
<one concise Chinese explanation>
```

No evaluator, hidden test, expected result, or other skill version is available.
Return only the concise user-visible result.
