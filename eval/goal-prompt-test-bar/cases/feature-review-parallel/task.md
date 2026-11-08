Read `/workspace/skill/SKILL.md` completely, follow it as the supplied Wayne Goal
Prompt skill, and read only the direct resources it routes this task to.

Compose a goal prompt only; do not modify files or dispatch it. The raw intent is:

> User, 2026-11-05 22:35 Asia/Shanghai: "升级我的 review
> service，最多并行 5 个 task，在 prompt 里告诉它开 wt 切到对应 pr 上 review".

The service lives in `/srv/tasks/groups/tasks`: systemd --user
`task-dashboard.service` runs `scripts/dashboard_server.py`, which starts
`scripts/pr_review_agent.py --worker`. The working tree has uncommitted changes in that
directory. The task context file is
`~/.wayne/projects/example/runs/review-service-parallel/context.md` (it does not exist yet; the executor creates it).

Return the copy-paste goal block and the required confirmation question.
