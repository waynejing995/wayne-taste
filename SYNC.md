# Wayne Skills — Sync Protocol

This folder (the `WAYNE_SKILLS_DIR` configured in `~/.wayne/config.env`) is the **single source of truth (SSoT)** for global rules, all `wayne-*` skills, and the shared `_shared/` library. Claude, Codex, and pi consume these files via **symlinks** that point back here. Edit a file once; every agent sees it instantly. No copying, no drift.

## Local path registry

`~/.wayne/config.env` is the user-owned registry for external Wayne locations:

```bash
WAYNE_SKILLS_DIR="$HOME/.wayne/skills"
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
~/.pi/agent/AGENTS.md        ──symlink──▶  ${WAYNE_SKILLS_DIR}/CLAUDE.md   (pi, via pi-config/sync.sh)
~/.claude/skills/<name>      ──symlink──▶  ${WAYNE_SKILLS_DIR}/<name>
~/.codex/skills/<name>       ──symlink──▶  ${WAYNE_SKILLS_DIR}/<name>
~/.agents/skills/<name>      ──symlink──▶  ${WAYNE_SKILLS_DIR}/<name>   (pi)
~/.pi/agent/extensions/<n>   ──symlink──▶  ${WAYNE_SKILLS_DIR}/pi-config/extensions/<n>
```

Because consumers are symlinks, **editing an existing skill needs no sync step** — the change is already live for every agent. Re-run `sync.sh` when a skill is **added or removed**, when a `pi-config/` file is added or renamed, or when setting up a machine.

pi's own _config_ (global rules, settings.json, statusline, saved workflows) has a separate linker, `pi-config/sync.sh`, which is its sole owner: `sync.sh` owns skill symlinks for all agents and **delegates** pi config to it rather than duplicating that link list. No link target is listed in two scripts.

## Daily rule

| You did this | Action needed |
| --- | --- |
| Edited an existing `wayne-*/SKILL.md` or `_shared/*.md` | Nothing — symlinks make it live for every agent |
| Added or removed a top-level `wayne-*` skill at the SoT | Run `bash sync.sh` |
| Edited an extension's source under `pi-config/extensions/` | Nothing to sync — but **restart pi**, or `/reload`: extension code is loaded once at startup |
| Added an extension, or changed its dependencies | Run `bash sync.sh` (it links the new one and installs `node_modules`) |
| Set up a fresh machine | Create `~/.wayne/config.env`, clone Wayne Taste at `WAYNE_SKILLS_DIR`, then run `bash "${WAYNE_SKILLS_DIR}/sync.sh"` — one command, pi config included |

## Extensions

`pi-config/extensions/<name>` is linked into `~/.pi/agent/extensions/<name>`.
pi's discovery follows symlinks — `core/extensions/loader.js` tests
`entry.isDirectory() || entry.isSymbolicLink()` — so an extension is SSoT-managed
exactly like a skill.

Two things are deliberately not in git, via each extension's own `.gitignore`:

- `node_modules/` — installed by `sync.sh` on first sync, into the checkout,
  because that is where Node resolves from. `sync.sh` fails loudly if npm is
  missing rather than leaving an extension that throws at load.
- `tests/` — the Teams suite was developed against a real mailbox and holds real
  names, addresses and conversation text. It stays on the machine it was written
  on; a clone gets a clean extension.

`sync.sh` only ever ADDS links. Machine-local extensions (herdr, orca) are left
untouched.

**Symlinks split module identity.** A test that imports
`~/.pi/agent/extensions/<n>/foo.ts` gets a different module object from the one
the extension itself loads via `./foo.ts`, because the loader caches by resolved
path. `instanceof` then fails across the two, and a stubbed function is a stub
nobody calls — the observed symptom was a test suite that hung on a real device-
code login. Resolve the real path first; `tests/ext-path.mjs` in the Teams
extension is the pattern.

## sync.sh

**The single entry point.** One command syncs everything; there is no second command to remember or forget.

```bash
bash "${WAYNE_SKILLS_DIR}/sync.sh"            # apply
bash "${WAYNE_SKILLS_DIR}/sync.sh" --dry-run  # preview, change nothing
```

Idempotent, and runs in two stages:

1. **Skills and global rules** — re-points every agent's skill dir at the SoT and links `~/.claude/CLAUDE.md`.
2. **pi config** — delegates to `pi-config/sync.sh`, which stays the sole owner of what lands in `~/.pi`. `--dry-run` is passed through unchanged.

Running `pi-config/sync.sh` directly is the pi-only path: still supported, but no longer something a full sync requires you to remember. `pi-config/bootstrap.sh` calls this top-level `sync.sh`, so the documented fresh-machine command produces a complete machine — skills, global rules and pi config — rather than pi config alone.

Safety properties:

- `ln -sfn` — overwrites only stale symlinks; never follows into a target dir.
- A real (non-symlink) consumer path is a hard error: sync never overwrites user state or silently leaves that agent drifted.
- A skill missing at the SoT is a hard error.
- Stale symlinks that target this SoT are removed; real paths and third-party symlinks are never touched.
- An agent is "installed" iff its **install marker** directory exists: `~/.claude`, `~/.codex`, and — for pi — `~/.pi`. The marker is the parent of the skills dir for Claude and Codex; pi is the exception, because it reads skills from `~/.agents/skills`, a path only `sync.sh` ever creates, so `~/.agents` cannot prove anything about pi.
- A missing marker is not an error: sync says the agent is not installed, links nothing for it, creates no directory for it, and keeps going. A marker that exists without the skills dir gets that directory created and fully linked.
- Stage failures aggregate: if the pi-config stage fails, the whole run fails and names the failing stage. A partial sync never reports success.

## What is and isn't synced

`sync.sh` derives the exposure list from `_shared`, every top-level `wayne-*` directory, and `waynejing`; no second skill registry exists to drift.

`eval/` is the skill test harness and `pi-config/` is pi's own configuration; neither is a skill and neither is linked as one. `pi-config/sync.sh` links four named files — `settings.json`, `pi-statusline.json`, `workflows/saved/wayne-code-review-flow.json` and the repo-root `CLAUDE.md` (as `AGENTS.md`) — into `~/.pi/agent/` and `~/.pi/workflows/saved/`, plus every directory under `pi-config/extensions/` into `~/.pi/agent/extensions/`. The rest of `pi-config/` (its own scripts, `internal-models-setup.md`, `README.md`) is never linked anywhere. `sync.sh` invokes it as its second stage.

## Agent discovery

Symlinks are the whole mechanism. Every agent enumerates the skill directories it is linked into and reads each `SKILL.md` frontmatter; the `description` field is what routes a request. A new skill is live once `sync.sh` has linked it — there is no second registration step.

- **Claude** — `~/.claude/skills/`
- **Codex** — `~/.codex/skills/`; skill tool name is lowercase `skill` (Claude uses uppercase `Skill`)
- **pi** — `~/.agents/skills/`, routed by `~/.pi/agent/AGENTS.md`, itself a symlink to `${WAYNE_SKILLS_DIR}/CLAUDE.md` created by `pi-config/sync.sh`

The trigger table in `CLAUDE.md` is a **convenience index for the human**, not a registry. Routing terms belong in the skill's own `description`, which `wayne-skill-forge` makes the single owner of triggering language. Adding a row is optional; omitting one does not make a skill undiscoverable, and a row that disagrees with the skill's `description` is drift.

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
