---
name: wayne-context-audit
description: See which skills you actually use, to decide what to prune. Reads the PreToolUse skill-usage log (~/.claude/skill-usage.jsonl) and reports per-skill invocation counts, last-used / days-idle, and installed-but-never-used prune candidates. For the static snapshot of what's loaded right now (per-item token cost of skills, agents, MCP, memory), just run the built-in `/context all` — this skill does NOT re-derive that. Use when asked to "audit skills", "which skills do I use", "is this skill used", "clean up my skills", or "what can I remove".
---

# Context Audit

Two questions, two tools — don't conflate them:

1. **"What's loaded right now and what does it cost?"** → run the built-in
   **`/context all`**. It already gives per-item token cost for every skill,
   agent, MCP tool, and memory file, grouped by source. It's the authoritative
   snapshot — this skill does not re-implement it, and neither should you.

2. **"Which skills do I actually invoke across sessions?"** → that's the gap
   `/context` can't fill (it's one moment, not history). This skill answers it
   from the usage log.

## Usage report

```bash
uv run --no-project python ~/.claude/skills/wayne-context-audit/skill_usage.py
# options: --idle-days N (default 30), -v
```

Reports:
- **Used skills by count** — invocations, last-used, days idle, status (enabled / disabled / external-plugin)
- **Installed but never used** — prune candidates
- **Disabled but still invoked** — re-enable candidates

### Data source (SSoT)

`~/.claude/skill-usage.jsonl` — append-only, one event per skill invocation:
`{ts, skill, args, cwd, session, source}`. Both agents write here:
- `source: "claude"` — from Claude's first-class `Skill` tool (exact).
- `source: "codex"` — inferred from Codex `Bash` calls that read a `SKILL.md`
  or run a script inside a skill dir (heuristic; mirrors Codex's own
  `detect_implicit_skill_invocation_for_command`). A mere file read counts as use.

Written by the PreToolUse hook. Logs only going forward — no retroactive data;
a 0-use skill may just predate the hook.

## Deciding what to cut

Cross-reference the two: `/context all` tells you a skill's **cost**, the usage
report tells you its **value** (how often it actually fires). High-cost +
never-used = first to go.

- **Prune** (installed, never used, idle): `mv ~/.claude/skills/<name> ~/.claude/skills-disabled/` — reversible.
- **Re-enable**: `mv ~/.claude/skills-disabled/<name> ~/.claude/skills/`.
- **Plugin skill** (status `external/plugin`): `claude plugin disable <id>`, not a folder move.

Always confirm the move list with the user before touching folders.

## Install the capture hook (prerequisite)

The bundled `skill-usage-audit.py` handles BOTH agents (one script, `source`
field distinguishes them). It is pure stdlib — no `uv`/deps needed.

### Claude

1. `cp hooks/skill-usage-audit.py ~/.claude/hooks/ && chmod +x ~/.claude/hooks/skill-usage-audit.py`
2. Register in `~/.claude/settings.json` under `hooks.PreToolUse` (matcher `Skill`):
   ```json
   {
     "matcher": "Skill",
     "hooks": [
       {"type": "command",
        "command": "uv run --no-project python ~/.claude/hooks/skill-usage-audit.py"}
     ]
   }
   ```

### Codex

Codex has no skill tool — it loads skills by `Bash`-reading `SKILL.md`, so the
hook matches `Bash` and infers the skill from the command.

1. `cp hooks/skill-usage-audit.py ~/.codex/hooks/ && chmod +x ~/.codex/hooks/skill-usage-audit.py`
2. `cp hooks/codex-hooks.json ~/.codex/hooks.json` (bundled — matcher `Bash`,
   command uses `/usr/bin/python3` because the hook PATH is minimal).
3. **Trust the hook**: Codex skips untrusted hooks. Trust it via the in-app
   `/hooks` command (interactive). `--dangerously-bypass-hook-trust` is NOT a
   reliable substitute in `codex exec`. Trust is keyed by hook hash, so any edit
   to `hooks.json` requires re-trusting.

Fail-safe (both): malformed input or write errors never block the tool call.
