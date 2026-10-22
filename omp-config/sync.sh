#!/usr/bin/env bash
# Sync omp config — single source of truth = THIS directory.
#
# Symlinks the shipped omp config back into ~/.omp/agent, mirroring
# pi-config/sync.sh: edit here once, omp sees it on its next agent discovery,
# no copy/drift. Idempotent. Also installs the m365 package (Teams and Outlook) as an
# omp plugin, and retires the pi-ext-teams and pi-ext-outlook plugins it replaced.
#
# Links:
#   ~/.omp/agent/AGENTS.md          -> repo-root CLAUDE.md (omp's global rules)
#   ~/.omp/agent/agents/<name>.md   -> omp-config/agents/<name>.md (task agents)
#   ~/.omp/agent/extensions/<n>.ts  -> omp-config/extensions/<n>.ts (extensions)
#   ~/.omp/plugins/node_modules/pi-ext-m365 -> pi-config/extensions/m365
#   ~/.omp/plugins/node_modules/pi-ext-{teams,outlook}  retired: symlink removed (see Plugins)
#   ~/.omp/plugins/omp-plugins.lock.json  enabled entry merged per plugin (not a link)
#
# omp's agent discovery accepts symlinked agent files
# (pi-coding-agent/src/task/discovery.ts tests
# `entry.isFile() || entry.isSymbolicLink()`). Any other agent file in
# ~/.omp/agent/agents is left alone — this script adds links, it never removes
# what it did not create, except the retired plugin symlinks listed above.
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

# Returns non-zero when it made no link, so a caller can skip what depends on it.
link_one() {
  local target="$1" link="$2"
  if [ ! -e "$target" ]; then
    report_issue "missing at SoT: ${target}"
    return 1
  fi
  if [ -e "$link" ] && [ ! -L "$link" ]; then
    report_issue "${link} is a real file, not a symlink"
    return 1
  fi
  if [ "$DRY" = "--dry-run" ]; then
    echo "WOULD ln -sfn ${target} ${link}"
    return 0
  fi
  if ! mkdir -p "$(dirname "$link")"; then
    report_issue "could not create parent directory for ${link}"
    return 1
  fi
  if ! ln -sfn "$target" "$link"; then
    report_issue "could not link ${link} -> ${target}"
    return 1
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

# ── Plugins ────────────────────────────────────────────────────────────────
# m365 (Teams and Outlook in one package) runs as an omp plugin. The list is explicit:
# slai and mind-explode-dag are pi-only and stay out. The package's npm dependencies are
# installed in its checkout, where Node resolves them. The lock file is omp's plugin
# registry: this merges one entry per plugin and leaves every other entry alone, except
# that the retired plugins below lose theirs.
PLUGINS="${HOME}/.omp/plugins"
PLUGIN_LOCK="${PLUGINS}/omp-plugins.lock.json"

# Merge { "<name>": { enabledFeatures: null, enabled: true } } into the lock. An
# entry that already exists keeps its other keys, enabledFeatures included. The
# file is created with empty plugins and settings maps when absent.
enable_plugin() {
  local name="$1"
  if [ "$DRY" = "--dry-run" ]; then
    echo "WOULD enable ${name} in ${PLUGIN_LOCK}"
    return
  fi
  if ! node -e '
    const fs = require("fs");
    const [file, name] = process.argv.slice(1);
    const lock = fs.existsSync(file)
      ? JSON.parse(fs.readFileSync(file, "utf8"))
      : { plugins: {}, settings: {} };
    lock.plugins ??= {};
    lock.plugins[name] = { enabledFeatures: null, ...lock.plugins[name], enabled: true };
    fs.writeFileSync(file, JSON.stringify(lock, null, 2) + "\n");
  ' "$PLUGIN_LOCK" "$name"; then
    report_issue "could not enable ${name} in ${PLUGIN_LOCK}"
    return
  fi
  echo "LOCK  enabled ${name} in ${PLUGIN_LOCK}"
}

# Delete one retired plugin's key from the lock and report it. The lock is read in every
# mode, and only a real run writes it. A missing lock, or an absent key, is no change; the
# file is never created here.
retire_lock_entry() {  # retire_lock_entry <name>
  local name="$1" mode=write state
  if [ "$DRY" = "--dry-run" ]; then
    mode=dry
  fi
  [ -f "$PLUGIN_LOCK" ] || return 0
  if ! state="$(node -e '
    const fs = require("fs");
    const [file, name, mode] = process.argv.slice(1);
    const lock = JSON.parse(fs.readFileSync(file, "utf8"));
    const present = Boolean(lock.plugins) && name in lock.plugins;
    if (present && mode === "write") {
      delete lock.plugins[name];
      fs.writeFileSync(file, JSON.stringify(lock, null, 2) + "\n");
    }
    console.log(present ? "present" : "absent");
  ' "$PLUGIN_LOCK" "$name" "$mode")"; then
    report_issue "could not retire ${name} from ${PLUGIN_LOCK}"
    return
  fi
  [ "$state" = "present" ] || return 0
  if [ "$mode" = dry ]; then
    echo "WOULD RETIRE ${name} from ${PLUGIN_LOCK}"
  else
    echo "RETIRE ${name} from ${PLUGIN_LOCK}"
  fi
}

# Remove one retired plugin: the symlink at its node_modules path, then its lock key. A real
# file or directory there is reported and left, and so is its key, because the old package is
# still installed.
retire_plugin() {  # retire_plugin <name>
  local name="$1" link="${PLUGINS}/node_modules/$1"
  if [ -e "$link" ] && [ ! -L "$link" ]; then
    report_issue "${link} is not a symlink; retired plugin ${name} is left in place"
    return
  fi
  if [ -L "$link" ]; then
    if [ "$DRY" = "--dry-run" ]; then
      echo "WOULD RETIRE ${link}"
    elif rm "$link"; then
      echo "RETIRE ${link}"
    else
      report_issue "could not remove retired plugin link ${link}"
      return
    fi
  fi
  retire_lock_entry "$name"
}

# teams and outlook were merged into m365, so their links and lock keys are retired first.
for retired in pi-ext-teams pi-ext-outlook; do
  retire_plugin "$retired"
done

for plugin_dir in m365; do
  pkg_dir="${SKILLS_ROOT}/pi-config/extensions/${plugin_dir}"
  pkg_json="${pkg_dir}/package.json"
  if [ ! -f "$pkg_json" ]; then
    report_issue "missing at SoT: ${pkg_json}"
    continue
  fi

  if [ ! -d "${pkg_dir}/node_modules" ]; then
    if [ "$DRY" = "--dry-run" ]; then
      echo "WOULD npm install --omit=dev in ${pkg_dir}"
    elif command -v npm >/dev/null 2>&1; then
      echo "NPM   installing dependencies for ${plugin_dir}"
      # Report dependency failures without blocking the other plugin.
      if ! (cd "$pkg_dir" && npm install --omit=dev --silent); then
        report_issue "npm install failed for ${plugin_dir}; omp will fail to load it"
      fi
    else
      report_issue "${plugin_dir} needs npm to install its dependencies, and npm was not found"
    fi
  fi

  plugin_name="$(node -p 'require(process.argv[1]).name' "$pkg_json" 2>/dev/null)"
  if [ -z "$plugin_name" ]; then
    report_issue "could not read the package name from ${pkg_json}"
    continue
  fi
  # A plugin whose link failed is not enabled: its lock entry would name nothing.
  if link_one "$pkg_dir" "${PLUGINS}/node_modules/${plugin_name}"; then
    enable_plugin "$plugin_name"
  fi
done

echo
echo "Done with ${ISSUES} omp-config issue(s). All possible syncs were attempted."
echo "Reminder: review-voice-2 needs the \`review\` model role set in ${AGENT}/config.yml"
echo "(config.yml is NOT synced — it holds machine/secret-specific config)."
