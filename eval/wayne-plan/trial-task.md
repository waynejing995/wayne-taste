Read `/workspace/skill/SKILL.md` completely and follow it, including every direct
reference or template it requires. Use only that supplied planning
skill; do not discover or invoke a globally installed planning skill.

Work in `/workspace/repo` and create an implementation plan for the approved
idempotent delivery retry feature. Read `AGENTS.md` and discover source artifacts
yourself. Do not implement code, modify source inputs, run gstack, invoke a global
review skill, commit, branch, push, or checkpoint.

If every gate passes, write one new plan under `docs/plans/` and return its path.
If a conflict or missing upstream E2E contract blocks planning, do not write a plan.
Return a compact blocker containing status, reason, affected artifacts, owner, and
a concise Chinese explanation. The following is an example, not a line grammar:

```text
STATUS: BLOCKED
REASON: PLAN_CONFLICT or MISSING_E2E
ARTIFACTS: <semicolon-separated repo-relative paths>
OWNER: product-design or test-design
<one concise Chinese explanation>
```

For `PLAN_CONFLICT`, communicate this meaning:

```text
检测到批准决策与 active plan 冲突；请由 product-design 解决后重试。
```

For `MISSING_E2E`, communicate this meaning:

```text
E2E contract 缺失；请由 test-design 补充并批准后重试。
```

No evaluator or expected result is available during this trial. Return only the
requested user-visible response; do not discuss the evaluator.
