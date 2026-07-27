#!/usr/bin/env bash
# Sync pi config — single source of truth = THIS directory.
#
# Symlinks the shipped pi config files back into ~/.pi/agent (and the saved
# workflow into ~/.pi/workflows), mirroring wayne-skills/sync.sh: edit here once,
# pi sees it instantly, no copy/drift. Idempotent.
#
# NOT synced here (intentionally): models.json (machine/secret specific — see
# internal-models-setup.md), ~/.pi/agent/extensions/ (herdr, orca — machine
# local), ~/.tmux.conf, and all state (auth.json, trust.json, models-store.json,
# npm/, workflows/projects/).
#
# Usage:  bash /mnt/share/wayne-skills/pi-config/sync.sh [--dry-run]
set -euo pipefail

SOT="/mnt/share/wayne-skills/pi-config"
AGENT="${HOME}/.pi/agent"
WF_SAVED="${HOME}/.pi/workflows/saved"
DRY="${1:-}"

link_one() {
  local target="$1" link="$2"
  if [ ! -e "$target" ]; then
    echo "SKIP  missing at SoT: ${target}"; return
  fi
  if [ -e "$link" ] && [ ! -L "$link" ]; then
    echo "SKIP  ${link} is a real file, not a symlink — leaving as-is (back it up + rm to adopt)"; return
  fi
  if [ "$DRY" = "--dry-run" ]; then
    echo "WOULD ln -sfn ${target} ${link}"; return
  fi
  mkdir -p "$(dirname "$link")"
  ln -sfn "$target" "$link"
  echo "LINK  ${link} -> ${target}"
}

link_one "${SOT}/settings.json"                          "${AGENT}/settings.json"
link_one "${SOT}/pi-statusline.json"                     "${AGENT}/pi-statusline.json"
link_one "${SOT}/workflows/saved/wayne-code-review-flow.json" "${WF_SAVED}/wayne-code-review-flow.json"

echo
echo "Done. Reminder: set up internal models per internal-models-setup.md"
echo "(models.json is NOT synced — it holds machine/secret-specific config)."
