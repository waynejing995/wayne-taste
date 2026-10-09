#!/usr/bin/env bash
# Sync omp config — single source of truth = THIS directory.
#
# Symlinks the shipped omp config back into ~/.omp/agent, mirroring
# pi-config/sync.sh: edit here once, omp sees it on its next agent discovery,
# no copy/drift. Idempotent.
#
# Links:
#   ~/.omp/agent/AGENTS.md          -> repo-root CLAUDE.md (omp's global rules)
#   ~/.omp/agent/agents/<name>.md   -> omp-config/agents/<name>.md (task agents)
#   ~/.omp/agent/extensions/<n>.ts  -> omp-config/extensions/<n>.ts (extensions)
#
# omp's agent discovery accepts symlinked agent files
# (pi-coding-agent/src/task/discovery.ts tests
# `entry.isFile() || entry.isSymbolicLink()`). Any other agent file in
# ~/.omp/agent/agents is left alone — this script adds links, it never removes
# what it did not create.
#
# NOT synced here (intentionally): config.yml (machine/secret specific; it owns
# the `review` model role that review-voice-2 binds via `model: "@review"`),
# models.yml, mcp.json, and all state (*.db, sessions/, memories/).
#
# Usage:  bash "${WAYNE_SKILLS_DIR}/omp-config/sync.sh" [--dry-run]
set -uo pipefail
ISSUES=0

report_issue() {
  echo "ERROR: $*" >&2
  ISSUES=$((ISSUES + 1))
}

WAYNE_HOME="${WAYNE_HOME:-${HOME}/.wayne}"
WAYNE_CONFIG="${WAYNE_CONFIG:-${WAYNE_HOME}/config.env}"
if [ -r "$WAYNE_CONFIG" ]; then
  . "$WAYNE_CONFIG"
fi

SKILLS_ROOT="${WAYNE_SKILLS_DIR:-$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd -P)}"
case "$SKILLS_ROOT" in
  /*) ;;
  *)
    report_issue "WAYNE_SKILLS_DIR must be an absolute path: ${SKILLS_ROOT}"
    echo "Done with ${ISSUES} issue(s); nothing synced."
    exit 0
    ;;
esac
if [ ! -d "$SKILLS_ROOT" ]; then
  report_issue "Wayne skills directory does not exist: ${SKILLS_ROOT}"
  echo "Done with ${ISSUES} issue(s); nothing synced."
  exit 0
fi

SOT="${SKILLS_ROOT}/omp-config"
AGENT="${HOME}/.omp/agent"
DRY="${1:-}"

link_one() {
  local target="$1" link="$2"
  if [ ! -e "$target" ]; then
    report_issue "missing at SoT: ${target}"
    return
  fi
  if [ -e "$link" ] && [ ! -L "$link" ]; then
    report_issue "${link} is a real file, not a symlink"
    return
  fi
  if [ "$DRY" = "--dry-run" ]; then
    echo "WOULD ln -sfn ${target} ${link}"
    return
  fi
  if ! mkdir -p "$(dirname "$link")"; then
    report_issue "could not create parent directory for ${link}"
    return
  fi
  if ! ln -sfn "$target" "$link"; then
    report_issue "could not link ${link} -> ${target}"
    return
  fi
  echo "LINK  ${link} -> ${target}"
}

# Global rules. Points at the SoT CLAUDE.md directly, NOT at another agent's
# link: chaining through ~/.claude or ~/.pi would break omp wherever those are absent.
link_one "${SKILLS_ROOT}/CLAUDE.md" "${AGENT}/AGENTS.md"

for agent_file in "${SOT}"/agents/*.md; do
  [ -f "$agent_file" ] || continue
  link_one "$agent_file" "${AGENT}/agents/$(basename "$agent_file")"
done

# Extensions: single-file modules. omp auto-discovers ~/.omp/agent/extensions/*.ts and
# loads the entry's realpath, so a symlinked file runs from here. Restart omp after an edit.
for ext_file in "${SOT}"/extensions/*.ts; do
  [ -f "$ext_file" ] || continue
  link_one "$ext_file" "${AGENT}/extensions/$(basename "$ext_file")"
done

echo
echo "Done with ${ISSUES} omp-config issue(s). All possible syncs were attempted."
echo "Reminder: review-voice-2 needs the \`review\` model role set in ${AGENT}/config.yml"
echo "(config.yml is NOT synced — it holds machine/secret-specific config)."
