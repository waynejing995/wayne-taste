# pi-config — shippable pi agent setup

Single source of truth for Wayne's pi coding-agent config, shipped the same way as `wayne-skills` (git SoT + `sync.sh` symlinks). Sibling to the skills in this repo.

## What's here

| File | Role | Synced to |
| --- | --- | --- |
| `settings.json` | **reference** suggested package list, theme, defaults | `~/.pi/agent/settings.json` — copied only if absent, never overwritten |
| `pi-statusline.json` | statusline layout/palette | `~/.pi/agent/pi-statusline.json` |
| `workflows/saved/wayne-code-review-flow.json` | dual model-family review workflow (portable) | `~/.pi/workflows/saved/` |
| `../CLAUDE.md` | global rules (shared SoT, not a file of this dir) | `~/.pi/agent/AGENTS.md` |
| `internal-models-setup.md` | **guide** to wire the AMD internal model provider | — (manual, secret-specific) |
| `sync.sh` | symlink shipped config → `~/.pi/...` (idempotent) | — |
| `bootstrap.sh` | fresh machine: `pi install` all packages + the repo-level `sync.sh` | — |

## Fresh machine

```bash
# pi must already be installed
bash "${WAYNE_SKILLS_DIR}/pi-config/bootstrap.sh"
# then follow internal-models-setup.md to create models.json + set AMD_APIM_KEY
```

That one command produces a complete machine: `bootstrap.sh` installs the packages and then calls the **repo-level** `sync.sh`, which links the Wayne skills and global rules and delegates pi config back to this directory's `sync.sh`. It exits non-zero and names every package that failed, so a run that installed nothing can never look like a success.

## Already-set-up machine (adopt SoT)

The repo-level `sync.sh` is the single entry point — it syncs skills, global rules **and** this directory's config in one command:

```bash
bash "${WAYNE_SKILLS_DIR}/sync.sh" --dry-run   # preview everything
bash "${WAYNE_SKILLS_DIR}/sync.sh"             # apply everything
```

To sync **only** pi config, call this directory's linker directly — the subordinate, pi-only path:

```bash
bash "${WAYNE_SKILLS_DIR}/pi-config/sync.sh" --dry-run   # preview
bash "${WAYNE_SKILLS_DIR}/pi-config/sync.sh"             # convert to symlinks
```

Either way `pi-config/sync.sh` is the sole owner of what lands in `~/.pi`; the repo-level script delegates to it rather than repeating its link list.

`sync.sh` refuses to clobber a real (non-symlink) file — back up + `rm` the live one first if you want the SoT to take over.

## Extensions

`extensions/teams` — Microsoft Teams in pi: unread in the status bar, a compose
overlay, and tools for reading, sending, searching people and downloading shared
files. Talks to Graph directly; `/teams login` signs in with a device code and
keeps its own token cache under `~/.cache/pi/teams-auth/`.

`sync.sh` links it into `~/.pi/agent/extensions/` and installs its three runtime
dependencies on first sync. Read `extensions/teams/README.md` before using it —
in particular the note on which client identity it signs in as.

## Intentionally NOT shipped

- **`models.json`** — machine/proxy/secret specific. Reconstruct via `internal-models-setup.md`. The APIM key lives in `${AMD_APIM_KEY}` (env or secret manager), never in git.
- **`~/.pi/agent/extensions/`** (herdr, orca) — machine-local.
- **`~/.tmux.conf`** — machine-local.
- **State**: `auth.json`, `trust.json`, `models-store.json` (regenerated), `npm/` (rebuilt by `pi install`), `workflows/projects/` (run history).

## Note on settings.json

`settings.json` is a **reference**, not a managed link: a suggested package list plus sane defaults. Every machine owns its own `~/.pi/agent/settings.json` (pi writes `theme`, `lastChangelogVersion` and `pi install` additions into it), so `sync.sh` copies the reference only when the machine has none, and otherwise leaves the local file alone and prints a diff against the reference — `-` is local-only, `+` is suggested here. Adopt what you want by hand.

Keeping the reference current is therefore a manual step: when a package earns its place, add it here and commit.
