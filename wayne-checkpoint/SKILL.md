---
name: wayne-checkpoint
description: Save and resume working state within the project. Captures git state, decision log progress, plan status, and remaining work so you can pick up exactly where you left off across sessions. Stored in .wayne/checkpoints/ (project-scoped, gitignored). Use when asked to "checkpoint", "save progress", "where was I", "resume", or "pick up where I left off".
---

# Wayne Checkpoint

Save and resume working state. Project-scoped — everything stays in `.wayne/checkpoints/`.

## Inherits from ~/.claude/CLAUDE.md

This skill inherits the Wayne control-plane invariants and does not redeclare them. The following are assumed and MUST NOT be repeated below:

- Language Rules (Chinese to user, English to files)
- Engineering Principles (KISS / YAGNI / DRY / SSoT / Fail-Loud / Push-Don't-Poll / Delete>Add)
- Code Standards (uv run python, markdown tables)
- Behavior Baselines (Think Before / Simplicity / Surgical / Goal-Driven)
- Skill invocation rule (proportional effort)

This skill only specifies the save / resume / list checkpoint workflow.

## Files Written

checkpoint markdown files at `.wayne/checkpoints/`.

## Commands

| Command | Action |
|---------|--------|
| `/wayne-checkpoint` or `/wayne-checkpoint save` | Save current state |
| `/wayne-checkpoint resume` | Load most recent checkpoint, resume |
| `/wayne-checkpoint list` | Show all checkpoints |

## Save Flow

### Step 1: Gather State

```bash
echo "=== BRANCH ==="
git rev-parse --abbrev-ref HEAD 2>/dev/null
echo "=== STATUS ==="
git status --short 2>/dev/null
echo "=== DIFF STAT ==="
git diff --stat 2>/dev/null
echo "=== STAGED ==="
git diff --cached --stat 2>/dev/null
echo "=== RECENT LOG ==="
git log --oneline -10 2>/dev/null
```

### Step 2: Gather Pipeline State

Read Wayne pipeline artifacts to enrich the checkpoint:

```bash
# Latest decision log
ls -t docs/decisions/*.md 2>/dev/null | head -1
# Latest plan
ls -t docs/plans/*.md 2>/dev/null | head -1
# Latest spec
ls -t docs/specs/*.md 2>/dev/null | head -1
# Task list state
# (read from TaskList if available)
```

For each artifact found, note:
- **Decision log:** how many decisions logged, status (in-progress/completed)
- **Plan:** which implementation units are done (checked `- [x]`) vs pending (`- [ ]`)
- **Spec:** status field from frontmatter

### Step 3: Summarize Context

Using git state + pipeline artifacts + conversation history, produce:

1. **Title** — 3-6 words describing the work (infer from context, don't ask)
2. **Pipeline stage** — where in the Wayne pipeline this work currently is
3. **Summary** — 1-3 sentences on the goal and current progress
4. **Decisions made** — key decisions from the log, with rationale
5. **Remaining work** — concrete next steps in priority order
6. **Notes** — gotchas, blockers, open questions, dead ends tried

### Step 4: Write Checkpoint

```bash
mkdir -p .wayne/checkpoints

# Self-contained gitignore (one-time setup)
[ -f .wayne/.gitignore ] || echo "*" > .wayne/.gitignore

TIMESTAMP=$(date +%Y%m%d-%H%M%S)
echo "TIMESTAMP=$TIMESTAMP"
```

Write to `.wayne/checkpoints/{TIMESTAMP}-{title-slug}.md`.

**Read first, then write:** `${HOME}/.claude/skills/wayne-checkpoint/templates/checkpoint-template.md`

The template is the canonical structure. Required sections:
- frontmatter: `title`, `status`, `branch`, `timestamp`, `pipeline_stage`, `pipeline_phase`, `decision_log`, `plan`, `spec`, `files_modified`
- `## Working on:` (title)
- `### Summary` (1-3 sentences)
- `### Pipeline State` (Stage, Phase, Last action, Next action)
- `### Decision Log Snapshot` (table copied from decision log)
- `### Implementation Units (from plan)` (checkbox format — wayne-work reads this on resume)
- `### Wave Progress (if parallel execution)` (table)
- `### Per-Task Review Status` (table)
- `### Remaining Work` (priority-ordered next steps)
- `### Notes` (gotchas, blockers, dead ends)
- `### Deferred Decisions` (unresolved questions from wayne-mind-explode)

**Format alignment:** The Implementation Units section uses the same checkbox format
as `wayne-plan`, so `wayne-work` can read it directly on resume without re-parsing
the plan file. The Decision Log Snapshot uses the same table format as
`wayne-mind-explode`'s decision log.

Confirm to user (in Chinese):

```
检查点已保存
════════════════════════════
标题:     {title}
分支:     {branch}
文件:     .wayne/checkpoints/{filename}
修改文件: {N} 个
阶段:     {pipeline stage}
════════════════════════════
```

---

## Resume Flow

### Step 1: Find Checkpoints

```bash
if [ -d .wayne/checkpoints ]; then
  find .wayne/checkpoints -maxdepth 1 -name "*.md" -type f 2>/dev/null | xargs ls -1t 2>/dev/null | head -10
else
  echo "NO_CHECKPOINTS"
fi
```

### Step 2: Load and Present

Read the most recent checkpoint (or user-specified one). Present in Chinese:

```
恢复检查点
════════════════════════════
标题:     {title}
分支:     {branch}
保存时间: {timestamp}
阶段:     {pipeline stage}
════════════════════════════

### 摘要
{summary}

### 待完成工作
{remaining work items}

### 注意事项
{notes}
```

If current branch differs from checkpoint branch, warn:
"这个检查点保存在 `{branch}` 分支。你现在在 `{current}` 分支。"

### Step 3: Verify Pipeline Artifacts Still Exist

Check that referenced decision log, plan, and spec files still exist:
```bash
[ -f "{decision_log_path}" ] && echo "DECISIONS: OK" || echo "DECISIONS: MISSING"
[ -f "{plan_path}" ] && echo "PLAN: OK" || echo "PLAN: MISSING"
[ -f "{spec_path}" ] && echo "SPEC: OK" || echo "SPEC: MISSING"
```

If any are missing, warn the user.

### Step 4: Auto-Resume Pipeline

Based on `pipeline_stage` from the checkpoint, **automatically invoke** the correct
Wayne skill — don't just suggest, actually invoke it via the Skill tool.

| Stage | Auto-invoke | What it gets |
|-------|-------------|--------------|
| `brainstorm` | `wayne-mind-explode` | Decision log path, resume from last question |
| `plan` | `wayne-plan` | Spec + decision log paths, resume from last phase |
| `work` | **`wayne-work`** | Plan path + checkpoint's Implementation Units as task input. Wayne-work reads the checkpoint's unit status and skips completed units. |
| `review` | `wayne-code-review` | Auto-run dual-voice review |
| `ship` | `wayne-ship` | Auto-run commit flow |
| `compound` | `wayne-compound` | Auto-run lessons capture |

**For `work` stage (most common resume):**

1. Read the checkpoint's **Implementation Units** section
2. Find the first `- [ ]` unit (not done)
3. Read the original plan file to get full unit details
4. Invoke `wayne-work` with the plan path — wayne-work will:
   - Skip already-completed units (marked `[x]` in checkpoint)
   - Resume from the next pending unit
   - Use the checkpoint's Wave Progress to restore parallel execution state
   - Check Deferred Decisions for unresolved items

```
告诉用户:
"从检查点恢复，自动继续 wayne-work。
已完成: Unit 1, Unit 2
下一个: Unit 3 — {goal}
启动中..."
```

Then invoke: `Skill(skill: "wayne-work")`

**Before auto-invoking, ask only if branch mismatch:**
If current branch differs from checkpoint branch, ask first:
```
A) 切换到 {checkpoint_branch} 分支然后继续
B) 在当前分支 {current_branch} 继续
C) 只是需要上下文，不继续工作
```

If no branch mismatch, auto-invoke immediately — no question needed.

---

## List Flow

```bash
if [ -d .wayne/checkpoints ]; then
  find .wayne/checkpoints -maxdepth 1 -name "*.md" -type f 2>/dev/null | xargs ls -1t 2>/dev/null
else
  echo "NO_CHECKPOINTS"
fi
```

Read frontmatter of each file. Present as table (in Chinese):

```
检查点列表
════════════════════════════════════════════
#  日期        标题                 阶段      状态
─  ──────────  ───────────────────  ────────  ──────────
1  2026-04-14  auth-middleware      work      in-progress
2  2026-04-13  email-notifications  review    in-progress
3  2026-04-12  dashboard-redesign   compound  completed
════════════════════════════════════════════
```

---

## Auto-Suggest

Proactively suggest saving a checkpoint when:
- Session is ending or context is getting long
- User is about to switch to a different task
- Before a risky operation
- At the end of any Wayne pipeline skill

---

## Integration with Wayne Pipeline

```
wayne-mind-explode → wayne-plan → wayne-work → wayne-code-review → wayne-ship → wayne-compound
                                      ↕                                              ↓
                              wayne-checkpoint ←──────────────────────────────────────┘
                           (save/resume at any point)
```

Checkpoint is **orthogonal** to the pipeline — it can save/resume at any stage.
The `pipeline_stage` field in the checkpoint tells resume which skill to suggest.

| Pipeline stage at save | Resume suggests |
|----------------------|-----------------|
| `brainstorm` | Invoke `wayne-mind-explode`, continue grilling |
| `plan` | Invoke `wayne-plan`, continue from last phase |
| `work` | Invoke `wayne-work`, resume from next pending unit |
| `review` | Invoke `wayne-code-review` |
| `ship` | Invoke `wayne-ship` |
| `compound` | Invoke `wayne-compound` |

---

## Key Principles

- **Project-scoped** — `.wayne/checkpoints/`, not `~/.gstack/`. Travels with the repo.
- **Append-only** — never overwrite or delete existing checkpoints
- **Read-only** — never modifies code, only reads state and writes checkpoint files
- **Pipeline-aware** — captures which Wayne skill was active and what phase
- **Infer, don't interrogate** — use git + pipeline artifacts + conversation to fill in context
- **Chinese for output, English for files**
