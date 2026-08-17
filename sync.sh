#!/usr/bin/env bash
# Sync protocol for wayne-skills — single source of truth = WAYNE_SKILLS_DIR.
#
# Claude (~/.claude/skills/), Codex (~/.codex/skills/) and pi (~/.agents/skills/)
# consume these skills via SYMLINKS pointing back here. Edit a file here once; all
# agents see it instantly. No copying, no drift.
#
# THE single entry point for a full sync. Stage 1 (this script) owns skill and
# global-rule symlinks; stage 2 delegates pi's own config to pi-config/sync.sh,
# which remains the sole owner of that link list and is still runnable on its
# own for a pi-only sync. A failing stage fails the whole run.
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
# An agent's install marker — the directory proving it is on this machine — is
# normally the parent of its skills dir, so it is derived, not listed twice.
# pi is the one exception: it lives in ~/.pi but reads skills from
# ~/.agents/skills, a path nothing but this script ever creates. Deriving pi's
# marker by parentage would report "not installed" on every fresh pi machine
# and skip linking skills while still syncing pi's config.
PI_HOME="${HOME}/.pi"
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

for agentdir in "$CLAUDE_SKILLS" "$CODEX_SKILLS" "$PI_SKILLS"; do
  echo "=== ${agentdir} ==="
  # The agent's install marker gates every link that agent owns — global rules
  # included. Two distinct states, never conflated: no marker = agent not
  # installed here (legitimate, announced, nothing created, nothing linked);
  # marker present but no skills dir = installed but never linked, so create the
  # dir and link. Marker is the skills dir's parent everywhere except pi.
  if [ "$agentdir" = "$PI_SKILLS" ]; then
    agenthome="$PI_HOME"
  else
    agenthome="$(dirname "$agentdir")"
  fi
  if [ ! -d "$agenthome" ]; then
    echo "NOT INSTALLED: ${agenthome} absent — agent is not installed on this machine; no links made"
    echo
    continue
  fi
  # Claude's global rules live in its home rather than its skills dir. Linking
  # them before the home check would make `ln` fail on the missing parent and
  # kill the whole run under `set -e`, starving agents that ARE installed.
  if [ "$agentdir" = "$CLAUDE_SKILLS" ]; then
    link_global_rules
  fi
  if [ ! -d "$agentdir" ]; then
    if [ "$DRY" = "--dry-run" ]; then
      echo "WOULD mkdir -p ${agentdir}"
    else
      mkdir -p "$agentdir"
      echo "MKDIR ${agentdir}"
    fi
  fi
  remove_stale_links "$agentdir"
  for s in "${SKILLS[@]}"; do
    link_one "${SOT}/${s}" "$agentdir" "$s"
  done
  echo
done

# ── Stage 2: pi's own config ────────────────────────────────────────────────
# Delegated, never reimplemented. pi-config/sync.sh stays the sole owner of the
# ~/.pi link list and remains independently runnable for a pi-only sync; this
# script only decides WHETHER to call it. Gated on PI_HOME, the same marker the
# skills stage uses, so both pi stages agree on whether pi is installed — NOT
# `command -v pi`, because the delegate only makes dirs and symlinks and would
# succeed without the binary being on PATH.
echo "=== ${PI_HOME}/agent (pi config) ==="
if [ ! -d "$PI_HOME" ]; then
  echo "NOT INSTALLED: ${PI_HOME} absent — pi is not installed on this machine; no links made"
elif ! bash "${SOT}/pi-config/sync.sh" ${DRY:+"$DRY"}; then
  echo >&2
  echo "FAILED stage: pi config (${SOT}/pi-config/sync.sh)." >&2
  echo "Skills and global rules ARE synced; pi config is NOT. This sync is INCOMPLETE." >&2
  exit 1
fi
echo
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
