# Wayne Skills — Sync Protocol

This folder (`/mnt/share/wayne-skills/`) is the **single source of truth (SSoT)**
for all `wayne-*` skills and the shared `_shared/` library. Both AI agents —
**Claude** and **Codex** — consume these skills via **symlinks** that point back
here. Edit a file once; both agents see it instantly. No copying, no drift.

## Topology

```
/mnt/share/wayne-skills/        ← SSoT (edit here, commit here)
  _shared/                      ← library: cybernetics-lens.md, e2e-contract.md
  wayne-*/SKILL.md              ← the skills
  sync.sh                       ← idempotent re-linker (run on add/remove)
  SYNC.md                       ← this file

~/.claude/skills/<name>  ──symlink──▶  /mnt/share/wayne-skills/<name>
~/.codex/skills/<name>   ──symlink──▶  /mnt/share/wayne-skills/<name>
```

Because consumers are symlinks, **editing an existing skill needs no sync step** —
the change is already live for both agents. `sync.sh` only matters when a skill is
**added or removed**.

## Daily rule

| You did this | Action needed |
|---|---|
| Edited an existing `wayne-*/SKILL.md` or `_shared/*.md` | Nothing — symlinks make it live for both agents |
| Added a NEW skill at the SoT | Add its name to `SKILLS[]` in `sync.sh`, run `bash sync.sh` |
| Removed a skill | Remove its name from `sync.sh`; delete the dangling symlinks in both agent dirs |
| Set up a fresh machine | Run `bash /mnt/share/wayne-skills/sync.sh` once |

## sync.sh

Idempotent. Re-points both agents' skill dirs at the SoT.

```bash
bash /mnt/share/wayne-skills/sync.sh            # apply
bash /mnt/share/wayne-skills/sync.sh --dry-run  # preview, change nothing
```

Safety properties:
- `ln -sfn` — overwrites only stale symlinks; never follows into a target dir.
- **Refuses to clobber a real (non-symlink) directory** — e.g. `wayne-context-audit`
  is a hand-managed real dir under `~/.claude/skills/`, so sync leaves it untouched.
- Skips any skill missing at the SoT (prints `SKIP`, never silently).

## What is and isn't synced

**Synced to BOTH agents** (the `SKILLS[]` array in `sync.sh`):
`_shared`, `wayne-checkpoint`, `wayne-code-review`, `wayne-compound`,
`wayne-cybernetics`, `wayne-distill`, `wayne-frontend-design`, `wayne-goal-prompt`,
`wayne-manner`,
`wayne-mind-explode`, `wayne-plan`, `wayne-ship`, `wayne-skill-forge`, `wayne-test-design`,
`wayne-verify`, `wayne-visual-synthesis`, `wayne-work`.

**Intentionally NOT synced:**

| Item | Why |
|---|---|
| `wayne-context-audit` | A real dir under `~/.claude/skills/`, not a symlink — hand-managed; sync refuses to clobber it. |
| `wayne-neat` | Present at SoT but not exposed to either agent yet. Add to `SKILLS[]` when ready. |
| `waynejing` | Claude-only today (linked under `~/.claude/skills/`, absent from Codex). Add a Codex link manually if/when wanted. |

## Agent registration (beyond symlinks)

Symlinks make skill FILES reachable. Each agent also needs the skill registered in
its routing/config:

- **Claude** — trigger table lives in `~/.claude/CLAUDE.md` (mirrored in this repo's
  `CLAUDE.md`). New skills need a trigger row there.
- **Codex** — discovers skills under `~/.codex/skills/` and routes per `~/.codex/AGENTS.md`
  ("Skills" section, proportional-effort rule). Skill tool name is lowercase `skill`
  (Claude uses uppercase `Skill`).

## Path differences (Claude vs Codex)

| Concern | Claude | Codex |
|---|---|---|
| Skills dir | `~/.claude/skills/` | `~/.codex/skills/` |
| How a skill is invoked | dedicated `Skill` tool | **no skill tool** — agent `Bash`-reads `SKILL.md` directly |
| Hook config | `~/.claude/settings.json` (`hooks` key) | `~/.codex/hooks.json` (same JSON schema) |
| Hook events | `PreToolUse`, `PostToolUse`, ... | identical event names |
| Hook trust | none | each hook hash must be trusted (`[hooks.state]` in `config.toml`) |

Codex hooks docs: https://developers.openai.com/codex/hooks

## Skill-usage audit hook

One script — `wayne-context-audit/hooks/skill-usage-audit.py` — handles **both**
agents, writing to the same `~/.claude/skill-usage.jsonl` with a `source` field.
Install steps for each agent: see `wayne-context-audit/SKILL.md`.

**Claude — deployed and working.** `PreToolUse` matcher `Skill` → the script →
`source: "claude"`. Fires because Claude invokes skills via a first-class
`Skill` tool; skill name comes straight from `tool_input.skill`.

**Codex — deployed and working (verified 2026-06-15).** Codex has no per-skill
tool for file-based skills — it loads a skill by `Bash`-reading its `SKILL.md`
(or running a script inside the skill dir). So the hook matches `Bash` and the
script infers the skill name from the command, mirroring Codex's own
`detect_implicit_skill_invocation_for_command` (doc-read + script-run signals).
Output: `source: "codex"`. Heuristic by nature — a mere `SKILL.md` read counts
as use. Bundled config: `wayne-context-audit/hooks/codex-hooks.json`.

Verified end-to-end: `sed -n .../wayne-ship/SKILL.md` in `codex exec` produced
`{"skill":"wayne-ship", ..., "source":"codex"}` in the log.

### Codex hook gotchas (learned the hard way)

- **Trust is the real gate.** Codex skips untrusted hooks. Trust via the in-app
  `/hooks` command (interactive; there is no `codex hooks` CLI subcommand). Trust
  is recorded as a hash under `[hooks.state]` in `~/.codex/config.toml`, keyed by
  `"<abs path>/hooks.json:pre_tool_use:<group>:<hook>"`. **Any edit to hooks.json
  changes the hash → must re-trust.** `--dangerously-bypass-hook-trust` proved
  unreliable in `codex exec`.
- **Feature flag** `hooks` must be enabled (default on — `codex features list`).
- **Minimal PATH:** the hook command must use an absolute interpreter
  (`/usr/bin/python3`), not `uv`/`python3` bare — the hook env's PATH lacks
  `~/.local/bin`. The script is pure stdlib, so `/usr/bin/python3` suffices.
- Config lives at `~/.codex/hooks.json` (user) or `<repo>/.codex/hooks.json`
  (project); schema is identical to Claude's `hooks` block.
- Payload fields: `tool_name`, `tool_input`, `cwd`, `session_id`,
  `hook_event_name`, `turn_id`, `model`, `permission_mode`.
