Read `/workspace/skill/SKILL.md` completely, follow it as the supplied Wayne Goal
Prompt skill, and read only the direct resources it routes this task to.

Compose a goal prompt only; do not modify files or dispatch it. The raw intent is:

> User, 2026-11-05 22:18 Asia/Shanghai: "目前我希望，monitor
> 的扫出来的问题，用 task delegation 的 model 走一遍，加上预处理方案，发群里，不要
> 真的去处理，我先观察一阵子".

Facts:
- The monitor is `/srv/wayne-skills/wayne-inbox/scripts/trace-monitor.py`
  (tests `test_trace_monitor.py`, posting prompt `trace-monitor.prompt.md`). A
  systemd user timer runs `trace-monitor.py --post` every 30 minutes; it reads the
  PROD TRACE DB read-only over ssh, judges with a magpie model, and posts a digest
  to the project Teams group.
- "task delegation 的 model" is omp `modelRoles.task` in `~/.omp/agent/config.yml`.
- Handling rules distilled from past incidents:
  `~/.wayne/projects/example/runs/trace-handling-rules/rules-draft.md`
  and its `RESULT.md` (coverage of the 7-day sample).
- 7-day sample of monitor findings:
  `~/.wayne/projects/example/runs/trace-confusion-monitor/replay-7d-raw.json`.
- Task context file: `~/.wayne/projects/example/runs/trace-monitor-preprocess/context.md` (it does not exist yet; the executor creates it).

Return the copy-paste goal block and the required confirmation question.
