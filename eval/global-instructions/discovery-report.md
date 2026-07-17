# Global discovery smoke

Date: 2026-07-17

The same SHA-256 instruction bytes were installed through each isolated global
surface. The task requested the marker defined only in those instructions.

| Lane | Result | Repository mutation |
|---|---|---|
| Claude `~/.claude/CLAUDE.md` | `GLOBAL_INSTRUCTION_SENTINEL` | none |
| Codex `$CODEX_HOME/AGENTS.md` | `GLOBAL_INSTRUCTION_SENTINEL` | none |

Claude must not use `--safe-mode`: current Claude CLI safe mode disables
`CLAUDE.md` and skills. The harness keeps provider state isolated instead.
