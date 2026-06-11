---
name: wayne-skill-audit
description: Audit local skill usage to decide what to prune. Reads the PreToolUse skill-usage log (~/.claude/skill-usage.jsonl), cross-references installed skills under ~/.claude/skills/ and ~/.claude/skills-disabled/, and reports usage counts, never-used prune candidates, and disabled-but-still-invoked re-enable candidates. Use when asked to "audit skills", "which skills do I use", "clean up my skills", "skill usage report", or "what skills can I remove".
---

# Skill Usage Audit

Decide which local skills to keep, prune, or re-enable — from real invocation data,
not guesses. Pairs with the `PreToolUse`/`Skill` hook at
`~/.claude/hooks/skill-usage-audit.py`, which appends one JSONL line per Skill call.

## Data source (SSoT)

`~/.claude/skill-usage.jsonl` — append-only log, one event per Skill invocation:
`{ts, skill, args, cwd, session}`. Written by the PreToolUse hook. If it's missing,
the hook hasn't fired yet (it only logs going forward — no retroactive data).

## Run the report

```bash
uv run --no-project python ~/.claude/skills/wayne-skill-audit/analyze.py
# options: --idle-days N (default 30), -v
```

Prints a markdown report:
- **Used skills by count** — with last-used date, days idle, enabled/disabled/external status
- **Installed but never used** — prune candidates
- **Disabled but still invoked** — re-enable candidates

## Acting on results

- **Prune candidate** (installed, never used, idle): move to backup, don't hard-delete —
  `mv ~/.claude/skills/<name> ~/.claude/skills-disabled/`. Reversible.
- **Re-enable candidate**: `mv ~/.claude/skills-disabled/<name> ~/.claude/skills/`.
- Plugin-provided skills (status `external/plugin`) aren't in `~/.claude/skills/`;
  toggle those via `enabledPlugins` in `settings.json`, not by moving folders.

Always confirm the move list with the user before touching folders. The log only
covers sessions since the hook was installed — a skill with 0 uses may just predate it.

## Install the capture hook

The analyzer only has data if the bundled `PreToolUse`/`Skill` hook is running.
On a new machine:

1. Copy the hook to your hooks dir:
   `cp hooks/skill-usage-audit.py ~/.claude/hooks/skill-usage-audit.py && chmod +x ~/.claude/hooks/skill-usage-audit.py`
2. Register it in `~/.claude/settings.json` under `hooks.PreToolUse`:
   ```json
   {
     "matcher": "Skill",
     "hooks": [
       {"type": "command",
        "command": "uv run --no-project python ~/.claude/hooks/skill-usage-audit.py"}
     ]
   }
   ```
3. The hook is fail-safe: malformed input or write errors never block the Skill call.
   It logs only `Skill` tool calls to `~/.claude/skill-usage.jsonl`.
