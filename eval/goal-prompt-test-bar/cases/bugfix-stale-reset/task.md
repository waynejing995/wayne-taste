Read `/workspace/skill/SKILL.md` completely, follow it as the supplied Wayne Goal
Prompt skill, and read only the direct resources it routes this task to.

Compose a goal prompt only; do not modify files or dispatch it. The raw intent is:

> User: "PR review 的 attempts 在涨个不停，TRACE#5 已经 49 次了。TRACE#88 最后是
> done，但 started_at 是 NULL。看起来 review 还在跑的时候就被重新排队了，worker
> 又把同一个 PR 领走，可能两个 reviewer 同时在审一个 PR。另外之前失败的原因也看
> 不到了，failure_reason 是 None，log 好像被覆盖了。修一下。"

The PR review service lives in `/srv/tasks/groups/tasks`
(`scripts/pr_review_agent.py`, `scripts/db.py`; systemd --user
`task-dashboard.service` runs the scan and the worker). The task context file is
`~/.wayne/projects/example/runs/pr-review-attempt-churn/context.md` (it does not exist yet; the executor creates it).

Return the copy-paste goal block and the required confirmation question.
