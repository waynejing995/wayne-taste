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
`wayne-cybernetics`, `wayne-frontend-design`, `wayne-manner`,
`wayne-mind-explode`, `wayne-plan`, `wayne-ship`, `wayne-verify`, `wayne-work`.

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
| Skill tool name | `Skill` (uppercase) | `skill` (lowercase) |
| Hook config | `~/.claude/settings.json` (`hooks` key) | `~/.codex/hooks.json` (same JSON schema) |
| Hook events | `PreToolUse`, `PostToolUse`, ... | identical event names; has a hook-trust gate |

## Skill-usage audit hook

- **Claude:** deployed. `PreToolUse` matcher `Skill` →
  `~/.claude/hooks/skill-usage-audit.py` → appends JSONL to `~/.claude/skill-usage.jsonl`.
- **Codex:** supported (same `hooks.json` schema, `PreToolUse` event), **not yet
  deployed**. Caveats before deploying: skill tool name is lowercase `skill` (the
  audit script matches `"Skill"`), the hook-trust gate may need a first-run trust,
  and the PreToolUse payload field names need confirming against a real invocation.
