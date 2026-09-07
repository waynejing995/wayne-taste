# pi-config — shippable pi agent setup

Single source of truth for Wayne's pi coding-agent config, shipped the same way as `wayne-skills` (git SoT + `sync.sh` symlinks). Sibling to the skills in this repo.

## What's here

| File | Role | Synced to |
| --- | --- | --- |
| `settings.json` | **reference** suggested package list, theme, defaults | `~/.pi/agent/settings.json` — copied only if absent, never overwritten |
| `pi-statusline.json` | statusline layout/palette | `~/.pi/agent/pi-statusline.json` |
| `workflows/saved/wayne-code-review-flow.json` | dual model-family review workflow (portable) | `~/.pi/workflows/saved/` |
| `extensions/` | Teams integration and the mind-explode decision DAG panel/tools | `~/.pi/agent/extensions/<name>` |
| `../CLAUDE.md` | global rules (shared SoT, not a file of this dir) | `~/.pi/agent/AGENTS.md` |
| `internal-models-setup.md` | **guide** to wire the AMD internal model provider | — (manual, secret-specific) |
| `sync.sh` | symlink shipped config → `~/.pi/...` (idempotent) | — |
| `bootstrap.sh` | fresh machine: `pi install` all packages + the repo-level `sync.sh` | — |

## Current reference defaults

`settings.json` is the authoritative package list and settings snapshot; the highlights are:

| Setting | Reference value |
| --- | --- |
| Startup model | `openai-amd/gpt-6-astra` |
| Thinking level | `high` |
| Theme / TUI | `catppuccin-mocha` / `regular` |
| Steering / follow-up delivery | `all` / `all` |
| Transport / HTTP idle timeout | `auto` / `0` (idle timeout disabled) |
| Project trust fallback | `always` — use `ask` instead on machines that open untrusted repositories |

The Ctrl+P model cycle includes `openai-amd/gpt-5.6-sol`,
`amd-internal-anthropic/Claude-Opus-5`, `ds-amd/DeepSeek-v4-pro`, and
`openai-amd/gpt-6-astra`. These entries select models; they do not register
providers or supply credentials. Configure the matching provider/model IDs in
your machine-local `models.json`. The setup guide's examples do not include
GPT-6 Astra or DeepSeek, so adapt them to your available endpoint and catalog.

## Fresh machine

```bash
# pi must already be installed
bash "${WAYNE_SKILLS_DIR}/pi-config/bootstrap.sh"
# then follow internal-models-setup.md to create models.json + set AMD_APIM_KEY
```

`bootstrap.sh` installs the packages and then calls the **repo-level** `sync.sh`, which links the Wayne skills and global rules and delegates pi config back to this directory's `sync.sh`. It exits non-zero and names every package that failed. Model/provider setup remains manual. Because `pi install` writes local settings before sync runs, compare that file with the reference afterwards and adopt the desired defaults; bootstrap does not force them onto an existing file.

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

`extensions/mind-explode-dag` — a live decision DAG above the input box for
`wayne-mind-explode` runs, plus the `wayne_resolve_decision` and
`wayne_upsert_decision_node` write tools. `/dag` or `alt+g` focuses the panel;
`/dag-run` pins a run. `sync.sh` links it alongside Teams. See
[the extension README](extensions/mind-explode-dag/README.md) for controls and
write semantics.

## Intentionally NOT shipped

- **`models.json`** — machine/proxy/secret specific. Reconstruct via `internal-models-setup.md`. The APIM key lives in `${AMD_APIM_KEY}` (env or secret manager), never in git.
- **Other extensions** under `~/.pi/agent/extensions/` (herdr, orca) — machine-local; only `pi-config/extensions/` is shipped.
- **`~/.tmux.conf`** — machine-local.
- **State**: `auth.json`, `trust.json`, `models-store.json` (regenerated), `npm/` (rebuilt by `pi install`), `workflows/projects/` (run history).

## Note on settings.json

`settings.json` is a **reference** by default: `sync.sh` copies it only when the machine has none, and otherwise preserves the existing file or symlink. When the contents differ, the script prints a diff — `-` is local-only, `+` is suggested here. Adopt what you want by hand.

An existing `~/.pi/agent/settings.json` symlink to this checkout stays linked. In that setup, settings written by pi (including model defaults, theme, `lastChangelogVersion`, and package changes) also change the tracked reference. Check `git diff -- pi-config/settings.json` before committing; those writes are not automatically intended for every machine.

Keep the reference current when a package or default earns its place. With a standalone local settings file, copy the intended changes here explicitly.
