# Global discovery smoke

Date: 2026-07-17

The same SHA-256 instruction bytes were installed through each isolated global
surface. The task requested the marker defined only in those instructions.

| Lane | Result | Repository mutation |
|---|---|---|
| Claude `~/.claude/CLAUDE.md` | `GLOBAL_INSTRUCTION_SENTINEL` | none |
| Codex `$CODEX_HOME/AGENTS.md` | `GLOBAL_INSTRUCTION_SENTINEL` | none |

Both input manifests carried identical candidate, task, base-tree, and harness
hashes, with different workspace and run-state IDs. Pair check: pass.

Claude trace had no hook event, hook `additionalContext`, or plugin. Its isolated
home contained only provider env plus `fixture-sentinel`; the remaining listed
skills/agents matched the frozen Claude product-core allowlist. Codex used a
provider-only config, no `AGENTS.override.md`, no user hook/MCP/project config, and
only `fixture-sentinel` beside Codex `.system` skills.

Claude must not use `--safe-mode`: current Claude CLI safe mode disables
`CLAUDE.md` and skills. Isolation is achieved with a fresh home, strict empty MCP
config, disabled Chrome integration, and no live `~/.claude` mount.

Calibration:

- static instructions: 1 positive + 38 independent mutations;
- behavior: 8 positive lanes + 13 independent mutations;
- isolation/pairing: 3 positive lanes + 19 independent mutations.

This report proves adapter readiness only. No trimmed candidate has yet been
accepted against the full control/candidate matrix.
