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
# settings.json is the ONE exception: it is a reference (suggested packages and
# defaults), not a managed link. It is copied only when the machine has none,
# and an existing local settings.json is never touched — the script just prints
# the diff against the reference.
#
# Extensions: only the ones shipped in pi-config/extensions/ are linked. Any
# other extension in ~/.pi/agent/extensions (herdr, orca, machine-local
# experiments) is left completely alone -- this script adds links and prunes dangling
# links into pi-config/extensions/ (an extension that was retired). It removes nothing else.
#
# NOT synced here (intentionally): models.json (machine/secret specific — see
# internal-models-setup.md), ~/.tmux.conf, and all state (auth.json, trust.json,
# models-store.json, npm/, workflows/projects/).
#
# Usage:  bash "${WAYNE_SKILLS_DIR}/pi-config/sync.sh" [--dry-run]
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

SOT="${SKILLS_ROOT}/pi-config"
AGENT="${HOME}/.pi/agent"
WF_SAVED="${HOME}/.pi/workflows/saved"
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

# settings.json is a REFERENCE, not a managed link: it carries the suggested
# package list and defaults, while each machine keeps its own local settings (pi
# writes theme, lastChangelogVersion and `pi install` additions into it). Seed it
# once when absent; never overwrite an existing one — instead show how the local
# file drifted from the reference, so a new suggested package is visible here
# rather than silently forced in.
seed_settings() {
  local target="${SOT}/settings.json" link="${AGENT}/settings.json"
  if [ ! -f "$target" ]; then
    report_issue "missing at SoT: ${target}"
    return
  fi
  if [ -e "$link" ] || [ -L "$link" ]; then
    if [ ! -r "$link" ]; then
      report_issue "${link} exists but is not readable (broken symlink?)"
      return
    fi
    if diff -q "$link" "$target" >/dev/null; then
      echo "KEEP  ${link} (local; identical to reference ${target})"
    else
      echo "KEEP  ${link} (local; NOT overwritten). Diff vs reference ${target}"
      echo "      '-' = only in your local file, '+' = suggested by the reference"
      diff -u "$link" "$target" | tail -n +3 | sed 's/^/      /'
    fi
    return
  fi
  if [ "$DRY" = "--dry-run" ]; then
    echo "WOULD cp ${target} ${link}  (seed: absent locally)"
    return
  fi
  if ! mkdir -p "$(dirname "$link")"; then
    report_issue "could not create parent directory for ${link}"
    return
  fi
  if ! cp "$target" "$link"; then
    report_issue "could not seed ${link} from ${target}"
    return
  fi
  echo "SEED  ${link} <- ${target} (copy, not a symlink; yours to edit)"
}

# Global rules. Points at the SoT CLAUDE.md directly, NOT at ~/.claude/CLAUDE.md:
# chaining through another agent's home would break pi wherever Claude is absent.
link_one "${SKILLS_ROOT}/CLAUDE.md"                      "${AGENT}/AGENTS.md"
seed_settings
link_one "${SOT}/pi-statusline.json"                     "${AGENT}/pi-statusline.json"
link_one "${SOT}/workflows/saved/wayne-code-review-flow.json" "${WF_SAVED}/wayne-code-review-flow.json"

# ── Extensions ──────────────────────────────────────────────────────────────
#
# Each pi-config/extensions/<name> is linked to ~/.pi/agent/extensions/<name>.
# pi's discovery follows symlinks (core/extensions/loader.js tests
# `entry.isDirectory() || entry.isSymbolicLink()`), so the checkout is the SoT
# for extension code exactly as it is for skills.
#
# Dependencies are NOT vendored: node_modules is gitignored, and installed here
# on first sync. It has to live inside the link target, because that is where
# Node resolves from.
for ext_dir in "${SOT}"/extensions/*/; do
  [ -d "$ext_dir" ] || continue
  ext_name="$(basename "$ext_dir")"
  link_one "${ext_dir%/}" "${AGENT}/extensions/${ext_name}"

  if [ -f "${ext_dir}package.json" ] && [ ! -d "${ext_dir}node_modules" ]; then
    if [ "$DRY" = "--dry-run" ]; then
      echo "WOULD npm install --omit=dev in ${ext_dir}"
    elif command -v npm >/dev/null 2>&1; then
      echo "NPM   installing dependencies for ${ext_name}"
      # Report dependency failures without blocking other extensions.
      if ! (cd "$ext_dir" && npm install --omit=dev --silent); then
        report_issue "npm install failed for ${ext_name}; pi will fail to load it"
      fi
    else
      report_issue "${ext_name} needs npm to install its dependencies, and npm was not found"
    fi
  fi
done

# Prints the physical location of a link's immediate target, leaf as written, or returns 1
# when that cannot be verified. A relative target is relative to the link's own directory.
# The parent is resolved with cd -P, so ".." and symlinks in it resolve as the kernel
# resolves them: the target's text proves nothing ("extensions/../../x" is not inside
# extensions). A missing parent cannot be verified. A missing leaf is fine, because a
# dangling link's leaf is missing by definition.
target_location() {  # target_location <link>
  local link="$1" target parent leaf base
  target="$(readlink "$link")" || return 1
  case "$target" in
    /*) ;;
    *)
      base="$(cd -P -- "$(dirname -- "$link")" >/dev/null 2>&1 && pwd -P)" || return 1
      target="${base}/${target}"
      ;;
  esac
  parent="$(dirname -- "$target")"
  leaf="$(basename -- "$target")"
  case "$leaf" in
    ''|.|..|/) return 1 ;;
  esac
  parent="$(cd -P -- "$parent" >/dev/null 2>&1 && pwd -P)" || return 1
  case "$parent" in
    /) printf '/%s\n' "$leaf" ;;
    *) printf '%s/%s\n' "$parent" "$leaf" ;;
  esac
}

# Prune: a dangling symlink whose target lies under pi-config/extensions/ (an extension that
# was retired or merged into another), judged by physical location. A real file or directory,
# and any link pointing elsewhere, is never touched.
ext_phys="$(cd -P -- "${SOT}/extensions" >/dev/null 2>&1 && pwd -P)"
if [ -n "$ext_phys" ]; then
  for link in "${AGENT}/extensions"/*; do
    [ -L "$link" ] && [ ! -e "$link" ] || continue
    loc="$(target_location "$link")" || continue
    case "$loc" in
      "${ext_phys}/"*) ;;
      *) continue ;;
    esac
    if [ "$DRY" = "--dry-run" ]; then
      echo "WOULD PRUNE ${link}"
    elif rm "$link"; then
      echo "PRUNE ${link}"
    else
      report_issue "could not prune dangling link ${link}"
    fi
  done
fi

echo
echo "Done with ${ISSUES} pi-config issue(s). All possible syncs were attempted."
echo "Reminder: set up internal models per internal-models-setup.md"
echo "(models.json is NOT synced — it holds machine/secret-specific config)."
