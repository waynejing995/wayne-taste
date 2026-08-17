#!/usr/bin/env bash
# Sync pi config — single source of truth = THIS directory.
#
# Symlinks the shipped pi config files back into ~/.pi/agent (and the saved
# workflow into ~/.pi/workflows), mirroring wayne-skills/sync.sh: edit here once,
# pi sees it instantly, no copy/drift. Idempotent.
#
# Also links ~/.pi/agent/AGENTS.md — pi's global rules — to the repo-root
# CLAUDE.md, the SoT both agents resolve to.
#
# NOT synced here (intentionally): models.json (machine/secret specific — see
# internal-models-setup.md), ~/.pi/agent/extensions/ (herdr, orca — machine
# local), ~/.tmux.conf, and all state (auth.json, trust.json, models-store.json,
# npm/, workflows/projects/).
#
# Usage:  bash "${WAYNE_SKILLS_DIR}/pi-config/sync.sh" [--dry-run]
set -euo pipefail

WAYNE_HOME="${WAYNE_HOME:-${HOME}/.wayne}"
WAYNE_CONFIG="${WAYNE_CONFIG:-${WAYNE_HOME}/config.env}"
if [ -r "$WAYNE_CONFIG" ]; then
  . "$WAYNE_CONFIG"
fi

SKILLS_ROOT="${WAYNE_SKILLS_DIR:-$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd -P)}"
case "$SKILLS_ROOT" in
  /*) ;;
  *) echo "ERROR: WAYNE_SKILLS_DIR must be an absolute path: ${SKILLS_ROOT}" >&2; exit 1 ;;
esac
[ -d "$SKILLS_ROOT" ] || { echo "ERROR: Wayne skills directory does not exist: ${SKILLS_ROOT}" >&2; exit 1; }

SOT="${SKILLS_ROOT}/pi-config"
AGENT="${HOME}/.pi/agent"
WF_SAVED="${HOME}/.pi/workflows/saved"
DRY="${1:-}"

link_one() {
  local target="$1" link="$2"
  if [ ! -e "$target" ]; then
    echo "ERROR: missing at SoT: ${target}" >&2
    return 1
  fi
  if [ -e "$link" ] && [ ! -L "$link" ]; then
    echo "ERROR: ${link} is a real file, not a symlink" >&2
    return 1
  fi
  if [ "$DRY" = "--dry-run" ]; then
    echo "WOULD ln -sfn ${target} ${link}"; return
  fi
  mkdir -p "$(dirname "$link")"
  ln -sfn "$target" "$link"
  echo "LINK  ${link} -> ${target}"
}

# Global rules. Points at the SoT CLAUDE.md directly, NOT at ~/.claude/CLAUDE.md:
# chaining through another agent's home would break pi wherever Claude is absent.
link_one "${SKILLS_ROOT}/CLAUDE.md"                      "${AGENT}/AGENTS.md"
link_one "${SOT}/settings.json"                          "${AGENT}/settings.json"
link_one "${SOT}/pi-statusline.json"                     "${AGENT}/pi-statusline.json"
link_one "${SOT}/workflows/saved/wayne-code-review-flow.json" "${WF_SAVED}/wayne-code-review-flow.json"

echo
echo "Done. Reminder: set up internal models per internal-models-setup.md"
echo "(models.json is NOT synced — it holds machine/secret-specific config)."
