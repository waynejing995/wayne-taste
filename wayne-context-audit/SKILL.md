---
name: wayne-context-audit
description: Audit what consumes context. Two modes. (1) Launch footprint — measures the static cost paid at turn zero (CLAUDE.md/memory sizes, enabled plugins + skills each ships, MCP servers, total skills surfaced). (2) Skill usage — reads the PreToolUse skill-usage log to report invocation counts, never-used prune candidates, and re-enable candidates. Use when asked to "audit context", "why does context fill up", "launch footprint", "audit skills", "which skills do I use", "clean up my skills", or "what can I remove".
---

# Context Audit

Find what eats context and decide what to cut — from measured data, not guesses.
Two independent analyzers; run either or both.

## Mode 1 — Launch footprint (static turn-zero cost)

What loads before the user types anything. The dominant cost is usually the
skill list, then CLAUDE.md and the MCP tool surface.

```bash
uv run --no-project python ~/.claude/skills/wayne-context-audit/launch_footprint.py --project .
```

Reports:
- **CLAUDE.md / memory** — line/word/byte of global + project CLAUDE.md + the current project's MEMORY.md
- **Total skills surfaced** — global + plugin-provided + project (enabled vs disabled)
- **Enabled plugins** — how many skills each ships (the biggest lever)
- **MCP servers** — the deferred-tool surface

Counts are line/word/byte proxies, not exact tokens.

**Levers, by impact:** disable unused plugins (`enabledPlugins` in `settings.json`)
> trim CLAUDE.md > move unused global skills to `skills-disabled/` > drop heavy MCP servers.

## Mode 2 — Skill usage (what you actually invoke)

Needs the capture hook installed (see below). Empty until the hook has run.

```bash
uv run --no-project python ~/.claude/skills/wayne-context-audit/skill_usage.py
# options: --idle-days N (default 30), -v
```

Reports: used skills by count (last-used, days idle, status), installed-but-never-used
**prune candidates**, and disabled-but-still-invoked **re-enable candidates**.

### Data source (SSoT)

`~/.claude/skill-usage.jsonl` — append-only, one event per Skill invocation:
`{ts, skill, args, cwd, session}`. Written by the PreToolUse hook. Logs only
going forward — no retroactive data; a 0-use skill may just predate the hook.

## Acting on results

- **Prune** (installed, never used, idle): `mv ~/.claude/skills/<name> ~/.claude/skills-disabled/` — reversible.
- **Re-enable**: `mv ~/.claude/skills-disabled/<name> ~/.claude/skills/`.
- **Plugin skill** (status `external/plugin`): toggle via `enabledPlugins` in `settings.json`, not by moving folders.

Always confirm the move list with the user before touching folders.

## Install the capture hook (Mode 2 prerequisite)

The bundled `PreToolUse`/`Skill` hook appends one JSONL line per Skill call.

1. `cp hooks/skill-usage-audit.py ~/.claude/hooks/skill-usage-audit.py && chmod +x ~/.claude/hooks/skill-usage-audit.py`
2. Register in `~/.claude/settings.json` under `hooks.PreToolUse`:
   ```json
   {
     "matcher": "Skill",
     "hooks": [
       {"type": "command",
        "command": "uv run --no-project python ~/.claude/hooks/skill-usage-audit.py"}
     ]
   }
   ```
3. Fail-safe: malformed input or write errors never block the Skill call.
