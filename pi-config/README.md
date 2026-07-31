# pi-config — shippable pi agent setup

Single source of truth for Wayne's pi coding-agent config, shipped the same way
as `wayne-skills` (git SoT + `sync.sh` symlinks). Sibling to the skills in this
repo.

## What's here

| File | Role | Synced to |
|---|---|---|
| `settings.json` | packages list (16 pi extensions), theme, defaults | `~/.pi/agent/settings.json` |
| `pi-statusline.json` | statusline layout/palette | `~/.pi/agent/pi-statusline.json` |
| `workflows/saved/wayne-code-review-flow.json` | dual model-family review workflow (portable) | `~/.pi/workflows/saved/` |
| `internal-models-setup.md` | **guide** to wire the AMD internal model provider | — (manual, secret-specific) |
| `sync.sh` | symlink shipped config → `~/.pi/...` (idempotent) | — |
| `bootstrap.sh` | fresh machine: `pi install` all packages + `sync.sh` | — |

## Fresh machine

```bash
# pi must already be installed
bash "${WAYNE_SKILLS_DIR}/pi-config/bootstrap.sh"
# then follow internal-models-setup.md to create models.json + set AMD_APIM_KEY
```

## Already-set-up machine (adopt SoT)

```bash
bash "${WAYNE_SKILLS_DIR}/pi-config/sync.sh" --dry-run   # preview
bash "${WAYNE_SKILLS_DIR}/pi-config/sync.sh"             # convert to symlinks
```
`sync.sh` refuses to clobber a real (non-symlink) file — back up + `rm` the live
one first if you want the SoT to take over.

## Intentionally NOT shipped

- **`models.json`** — machine/proxy/secret specific. Reconstruct via
  `internal-models-setup.md`. The APIM key lives in `${AMD_APIM_KEY}` (env or
  secret manager), never in git.
- **`~/.pi/agent/extensions/`** (herdr, orca) — machine-local.
- **`~/.tmux.conf`** — machine-local.
- **State**: `auth.json`, `trust.json`, `models-store.json` (regenerated),
  `npm/` (rebuilt by `pi install`), `workflows/projects/` (run history).

## Note on symlinking settings.json

`settings.json` is symlinked, so pi's own writes (e.g. a new `pi install`
appending to `packages[]`, or `lastChangelogVersion`) flow back into this SoT —
keeping the package list current with no manual step. Commit the churn as normal.
