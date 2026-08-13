# Wayne Skills — Sync Protocol

This folder (the `WAYNE_SKILLS_DIR` configured in `~/.wayne/config.env`) is the **single source of truth (SSoT)** for global rules, all `wayne-*` skills, and the shared `_shared/` library. Claude, Codex, and pi consume these files via **symlinks** that point back here. Edit a file once; every agent sees it instantly. No copying, no drift.

## Local path registry

`~/.wayne/config.env` is the user-owned registry for external Wayne locations:

```bash
WAYNE_SKILLS_DIR="/Users/chenjingwen/.wayne/skills"
WAYNE_KB_DIR="/mnt/share/wayne-note"
```

`WAYNE_SKILLS_DIR` must name this clone. `WAYNE_KB_DIR` may be unavailable until its external mount is configured; no sync operation falls back to another KB path.

## Topology

```
${WAYNE_SKILLS_DIR}/             ← SSoT (edit here, commit here)
  _shared/                       ← library: pipeline-id-contract.md and shared contracts
  wayne-*/SKILL.md               ← the skills
  sync.sh                         ← idempotent re-linker (run on add/remove)
  SYNC.md                         ← this file

~/.claude/CLAUDE.md          ──symlink──▶  ${WAYNE_SKILLS_DIR}/CLAUDE.md
~/.claude/skills/<name>      ──symlink──▶  ${WAYNE_SKILLS_DIR}/<name>
~/.codex/skills/<name>       ──symlink──▶  ${WAYNE_SKILLS_DIR}/<name>
~/.agents/skills/<name>      ──symlink──▶  ${WAYNE_SKILLS_DIR}/<name>   (pi)
```

Because consumers are symlinks, **editing an existing skill needs no sync step** — the change is already live for every agent. `sync.sh` only matters when a skill is **added or removed**.

pi's own _config_ (settings.json, statusline, saved workflows) is a separate concern with a separate linker: `pi-config/sync.sh`. `sync.sh` owns skill symlinks for all agents; `pi-config/sync.sh` owns pi config files.

## Daily rule

| You did this | Action needed |
| --- | --- |
| Edited an existing `wayne-*/SKILL.md` or `_shared/*.md` | Nothing — symlinks make it live for every agent |
| Added or removed a top-level `wayne-*` skill at the SoT | Run `bash sync.sh` |
| Set up a fresh machine | Create `~/.wayne/config.env`, clone Wayne Taste at `WAYNE_SKILLS_DIR`, then run `bash "${WAYNE_SKILLS_DIR}/sync.sh"` and `bash "${WAYNE_SKILLS_DIR}/pi-config/sync.sh"` for pi |

## sync.sh

Idempotent. Re-points every agent's skill dir at the SoT.

```bash
bash "${WAYNE_SKILLS_DIR}/sync.sh"            # apply
bash "${WAYNE_SKILLS_DIR}/sync.sh" --dry-run  # preview, change nothing
```

Safety properties:

- `ln -sfn` — overwrites only stale symlinks; never follows into a target dir.
- A real (non-symlink) consumer path is a hard error: sync never overwrites user state or silently leaves that agent drifted.
- A skill missing at the SoT is a hard error.
- Stale symlinks that target this SoT are removed; real paths and third-party symlinks are never touched.

## What is and isn't synced

`sync.sh` derives the exposure list from `_shared`, every top-level `wayne-*` directory, and `waynejing`; no second skill registry exists to drift.

`eval/` is the skill test harness and `pi-config/` is pi's own configuration; neither is a skill. `pi-config/sync.sh` links the latter into `~/.pi/agent/`.

## Agent registration (beyond symlinks)

Symlinks make skill FILES reachable. Each agent also needs the skill registered in its routing/config:

- **Claude** — trigger table lives in `~/.claude/CLAUDE.md` (mirrored in this repo's `CLAUDE.md`). New skills need a trigger row there.
- **Codex** — discovers skills under `~/.codex/skills/` and routes per `~/.codex/AGENTS.md` ("Skills" section, proportional-effort rule). Skill tool name is lowercase `skill` (Claude uses uppercase `Skill`).
- **pi** — discovers skills under `~/.agents/skills/` and routes per `~/.pi/agent/AGENTS.md`, which is itself a symlink to `~/.claude/CLAUDE.md`, so pi and Claude share one trigger table. A new skill needs a trigger row there once, not twice.

## Path differences (Claude vs Codex)

| Concern | Claude | Codex |
| --- | --- | --- |
| Skills dir | `~/.claude/skills/` | `~/.codex/skills/` |
| How a skill is invoked | dedicated `Skill` tool | **no skill tool** — agent `Bash`-reads `SKILL.md` directly |
| Hook config | `~/.claude/settings.json` (`hooks` key) | `~/.codex/hooks.json` (same JSON schema) |
| Hook events | `PreToolUse`, `PostToolUse`, ... | identical event names |
| Hook trust | none | each hook hash must be trusted (`[hooks.state]` in `config.toml`) |

Codex hooks docs: https://developers.openai.com/codex/hooks

## Skill-usage audit hook

One script — `wayne-context-audit/hooks/skill-usage-audit.py` — handles **both** agents, writing to the same `~/.claude/skill-usage.jsonl` with a `source` field. Install steps for each agent: see `wayne-context-audit/SKILL.md`.

**Claude — deployed and working.** `PreToolUse` matcher `Skill` → the script → `source: "claude"`. Fires because Claude invokes skills via a first-class `Skill` tool; skill name comes straight from `tool_input.skill`.

**Codex — deployed and working (verified 2026-06-15).** Codex has no per-skill tool for file-based skills — it loads a skill by `Bash`-reading its `SKILL.md` (or running a script inside the skill dir). So the hook matches `Bash` and the script infers the skill name from the command, mirroring Codex's own `detect_implicit_skill_invocation_for_command` (doc-read + script-run signals). Output: `source: "codex"`. Heuristic by nature — a mere `SKILL.md` read counts as use. Bundled config: `wayne-context-audit/hooks/codex-hooks.json`.

Verified end-to-end: `sed -n .../wayne-ship/SKILL.md` in `codex exec` produced `{"skill":"wayne-ship", ..., "source":"codex"}` in the log.

### Codex hook gotchas (learned the hard way)

- **Trust is the real gate.** Codex skips untrusted hooks. Trust via the in-app `/hooks` command (interactive; there is no `codex hooks` CLI subcommand). Trust is recorded as a hash under `[hooks.state]` in `~/.codex/config.toml`, keyed by `"<abs path>/hooks.json:pre_tool_use:<group>:<hook>"`. **Any edit to hooks.json changes the hash → must re-trust.** `--dangerously-bypass-hook-trust` proved unreliable in `codex exec`.
- **Feature flag** `hooks` must be enabled (default on — `codex features list`).
- **Minimal PATH:** the hook command must use an absolute interpreter (`/usr/bin/python3`), not `uv`/`python3` bare — the hook env's PATH lacks `~/.local/bin`. The script is pure stdlib, so `/usr/bin/python3` suffices.
- Config lives at `~/.codex/hooks.json` (user) or `<repo>/.codex/hooks.json` (project); schema is identical to Claude's `hooks` block.
- Payload fields: `tool_name`, `tool_input`, `cwd`, `session_id`, `hook_event_name`, `turn_id`, `model`, `permission_mode`.
