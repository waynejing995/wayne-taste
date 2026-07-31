#!/usr/bin/env bash
# Sync protocol for wayne-skills — single source of truth = WAYNE_SKILLS_DIR.
#
# Claude (~/.claude/skills/), Codex (~/.codex/skills/) and pi (~/.agents/skills/)
# consume these skills via SYMLINKS pointing back here. Edit a file here once; all
# agents see it instantly. No copying, no drift.
#
# This script is idempotent: run it any time a skill is ADDED or REMOVED at the
# SoT to re-point every agent. Editing an existing skill needs no re-run.
#
# Usage:  bash "${WAYNE_SKILLS_DIR}/sync.sh" [--dry-run]
set -euo pipefail

WAYNE_HOME="${WAYNE_HOME:-${HOME}/.wayne}"
WAYNE_CONFIG="${WAYNE_CONFIG:-${WAYNE_HOME}/config.env}"
if [ -r "$WAYNE_CONFIG" ]; then
  # User-owned path registry; it only defines Wayne locations.
  . "$WAYNE_CONFIG"
fi

SOT="${WAYNE_SKILLS_DIR:-$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)}"

case "$SOT" in
  /*) ;;
  *) echo "ERROR: WAYNE_SKILLS_DIR must be an absolute path: ${SOT}" >&2; exit 1 ;;
esac
[ -d "$SOT" ] || { echo "ERROR: Wayne skills directory does not exist: ${SOT}" >&2; exit 1; }
CLAUDE_SKILLS="${HOME}/.claude/skills"
CLAUDE_RULES="${HOME}/.claude/CLAUDE.md"
CODEX_SKILLS="${HOME}/.codex/skills"
PI_SKILLS="${HOME}/.agents/skills"
DRY="${1:-}"

# Skills to expose to EVERY agent. _shared is a library dir (referenced by
# SKILL.md files), not a skill itself, but must be linked so refs resolve.
# Top-level wayne-* directories are the authoritative skill set.
LC_COLLATE=C
export LC_COLLATE
SKILLS=(_shared)
for skill_dir in "$SOT"/wayne-*; do
  [ -d "$skill_dir" ] || continue
  SKILLS+=("${skill_dir##*/}")
done
SKILLS+=(waynejing)

link_one() {
  local target="$1" linkdir="$2" name="$3"
  local link="${linkdir}/${name}"
  if [ ! -e "$target" ]; then
    echo "ERROR: ${name}: missing at SoT (${target})" >&2
    return 1
  fi
  # A real file or directory has its own state. Do not overwrite it and do not
  # silently leave this consumer drifted from the SoT.
  if [ -e "$link" ] && [ ! -L "$link" ]; then
    echo "ERROR: ${name}: ${link} is a real path, not a symlink" >&2
    return 1
  fi
  if [ "$DRY" = "--dry-run" ]; then
    echo "WOULD ln -sfn ${target} ${link}"
    return
  fi
  ln -sfn "$target" "$link"
  echo "LINK  ${name} -> ${target}"
}

link_global_rules() {
  local target="${SOT}/CLAUDE.md"
  if [ ! -f "$target" ]; then
    echo "ERROR: missing global rules at SoT (${target})" >&2
    return 1
  fi
  if [ -e "$CLAUDE_RULES" ] && [ ! -L "$CLAUDE_RULES" ]; then
    if ! cmp -s "$target" "$CLAUDE_RULES"; then
      echo "ERROR: ${CLAUDE_RULES} differs from ${target}; reconcile before linking" >&2
      return 1
    fi
    if [ "$DRY" = "--dry-run" ]; then
      echo "WOULD replace identical ${CLAUDE_RULES} with a symlink to ${target}"
      return
    fi
    rm "$CLAUDE_RULES"
  fi
  if [ "$DRY" = "--dry-run" ]; then
    echo "WOULD ln -sfn ${target} ${CLAUDE_RULES}"
    return
  fi
  ln -sfn "$target" "$CLAUDE_RULES"
  echo "LINK  global rules -> ${target}"
}

is_expected_skill() {
  local name="$1" skill
  for skill in "${SKILLS[@]}"; do
    [ "$skill" = "$name" ] && return 0
  done
  return 1
}

remove_stale_links() {
  local link name target
  for link in "$1"/_shared "$1"/wayne-* "$1"/waynejing; do
    [ -L "$link" ] || continue
    target="$(readlink "$link")"
    case "$target" in
      "${SOT}"/*) ;;
      *) continue ;;
    esac
    name="${link##*/}"
    is_expected_skill "$name" && continue
    if [ "$DRY" = "--dry-run" ]; then
      echo "WOULD rm ${link}"
      continue
    fi
    rm "$link"
    echo "REMOVE ${name} -> ${target}"
  done
}
link_global_rules

for agentdir in "$CLAUDE_SKILLS" "$CODEX_SKILLS" "$PI_SKILLS"; do
  echo "=== ${agentdir} ==="
  [ -d "$agentdir" ] || { echo "SKIP agent dir absent: ${agentdir}"; continue; }
  remove_stale_links "$agentdir"
  for s in "${SKILLS[@]}"; do
    link_one "${SOT}/${s}" "$agentdir" "$s"
  done
  echo
done

echo "Done. Verify with:  ls -la ${CLAUDE_SKILLS} ${CODEX_SKILLS} ${PI_SKILLS} | grep wayne"

# ── Skill-usage audit hook (informational; this script does NOT install it) ──
# One script handles BOTH agents, bundled under wayne-context-audit/hooks/:
#   skill-usage-audit.py   - dual-agent (source=claude|codex), writes
#                            ~/.claude/skill-usage.jsonl
#   codex-hooks.json       - Codex PreToolUse config (matcher Bash)
# Claude:  install into ~/.claude/hooks/ + register in settings.json (matcher Skill).
# Codex:   install into ~/.codex/hooks/ + ~/.codex/hooks.json, then TRUST via /hooks.
# Full per-agent steps + gotchas: wayne-context-audit/SKILL.md and SYNC.md.
echo
echo "Hook note: dual-agent skill-audit hook bundled under wayne-context-audit/hooks/"
echo "           (skill-usage-audit.py + codex-hooks.json). Install per its SKILL.md."
