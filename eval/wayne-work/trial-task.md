Read `/workspace/skill/SKILL.md` completely and follow it. Use only that supplied
implementation skill; do not discover a globally installed copy.

Work in `/workspace/repo`. Read `AGENTS.md`, `case.md`, and the approved decision record in
the repository. The approved plan and test matrix are project state outside the repository.
Plans are in `/workspace/wayne-home/projects/repo/plans/`. The test matrix for a plan is
`/workspace/wayne-home/projects/repo/runs/<topic>/test-matrix.md`, where `<topic>` is the
plan's feature slug (`delivery-retry` or `parallel-units`). Never write state into the
repository.
Implement the plan only when those sources are complete and non-conflicting. Use the
exact verification commands from the plan. Do not inspect or modify `.git`, commit,
branch, push, open a PR, invoke code review, or auto-run the next pipeline stage.

If source inputs block implementation, change nothing and return exactly five
non-empty lines:

```text
STATUS: BLOCKED
REASON: PLAN_SCOPE_CONFLICT or MISSING_U_ROW
ARTIFACTS: <semicolon-separated input paths: repo-relative, or absolute /workspace/wayne-home/... state paths>
OWNER: planning
<one concise Chinese explanation>
```

No evaluator, hidden test, expected result, or other skill version is available.
Return only the concise user-visible result.
