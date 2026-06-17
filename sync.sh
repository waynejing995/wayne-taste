#!/usr/bin/env bash
# Sync protocol for wayne-skills — single source of truth = THIS directory.
#
# Both Claude (~/.claude/skills/) and Codex (~/.codex/skills/) consume these
# skills via SYMLINKS pointing back here. Edit a file here once; both agents see
# it instantly. No copying, no drift.
#
# This script is idempotent: run it any time a skill is ADDED or REMOVED at the
# SoT to re-point both agents. Editing an existing skill needs no re-run.
#
# Usage:  bash /mnt/share/wayne-skills/sync.sh [--dry-run]
set -euo pipefail

SOT="/mnt/share/wayne-skills"
CLAUDE_SKILLS="${HOME}/.claude/skills"
CODEX_SKILLS="${HOME}/.codex/skills"
DRY="${1:-}"

# Skills to expose to BOTH agents. _shared is a library dir (referenced by
# SKILL.md files), not a skill itself, but must be linked so refs resolve.
SKILLS=(
  _shared
  wayne-checkpoint
  wayne-code-review
  wayne-compound
  wayne-cybernetics
  wayne-distill
  wayne-frontend-design
  wayne-goal-prompt
  wayne-manner
  wayne-mind-explode
  wayne-plan
  wayne-ship
  wayne-skill-forge
  wayne-test-design
  wayne-verify
  wayne-visual-synthesis
  wayne-work
)

# NOTE — intentionally NOT synced:
#   wayne-context-audit : exists as a REAL dir under ~/.claude/skills (not a
#                         symlink); leave it alone, do not clobber.
#   wayne-neat          : present at SoT but deliberately not exposed to either
#                         agent yet. Add to SKILLS[] above when ready.
#   waynejing           : Claude-only today; add a CLAUDE-only block if needed.

link_one() {
  local target="$1" linkdir="$2" name="$3"
  local link="${linkdir}/${name}"
  if [ ! -e "$target" ]; then
    echo "SKIP  ${name}: missing at SoT (${target})"
    return
  fi
  # Refuse to clobber a real (non-symlink) directory — that is hand-managed.
  if [ -e "$link" ] && [ ! -L "$link" ]; then
    echo "SKIP  ${name}: ${link} is a real dir, not a symlink — leaving as-is"
    return
  fi
  if [ "$DRY" = "--dry-run" ]; then
    echo "WOULD ln -sfn ${target} ${link}"
    return
  fi
  ln -sfn "$target" "$link"
  echo "LINK  ${name} -> ${target}"
}

for agentdir in "$CLAUDE_SKILLS" "$CODEX_SKILLS"; do
  echo "=== ${agentdir} ==="
  [ -d "$agentdir" ] || { echo "SKIP agent dir absent: ${agentdir}"; continue; }
  for s in "${SKILLS[@]}"; do
    link_one "${SOT}/${s}" "$agentdir" "$s"
  done
  echo
done

echo "Done. Verify with:  ls -la ${CLAUDE_SKILLS} ${CODEX_SKILLS} | grep wayne"

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
