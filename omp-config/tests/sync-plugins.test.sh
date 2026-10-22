#!/usr/bin/env bash
# U26 (S19): omp-config/sync.sh installs the m365 plugin (Teams and Outlook in one
# package) and retires the pi-ext-teams and pi-ext-outlook plugins it replaced.
#
# Every case runs the real script with a temporary HOME and a fixture checkout built
# under $TMP: one package, pi-config/extensions/m365, whose package.json is
# {"name":"pi-ext-m365"}. The real checkout is never read, so the test does not depend
# on its layout. npm is a stub on PATH, so nothing is installed from the network.
#
# Usage:  bash omp-config/tests/sync-plugins.test.sh
set -uo pipefail

CHECKOUT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd -P)"
SYNC="${CHECKOUT}/omp-config/sync.sh"
TMP="$(cd -P -- "$(mktemp -d)" && pwd -P)"
trap 'rm -rf "$TMP"' EXIT
FAILS=0

expect() {  # expect <label> <command...>
  local label="$1"
  shift
  if "$@"; then
    echo "PASS  ${label}"
  else
    echo "FAIL  ${label}"
    FAILS=$((FAILS + 1))
  fi
}

log_has() { grep -qF -- "$2" "$1"; }
log_lacks() { ! grep -qF -- "$2" "$1"; }
# log_has_all <log> <text...>: every text appears in the log.
log_has_all() {
  local log="$1" text
  shift
  for text in "$@"; do
    grep -qF -- "$text" "$log" || return 1
  done
}
is_real_dir() { [ -d "$1" ] && [ ! -L "$1" ]; }
is_absent() { [ ! -e "$1" ] && [ ! -L "$1" ]; }

# The whole lock file deep-equals the expected JSON (key order ignored).
lock_is() {  # lock_is <lock-file> <expected-json>
  node -e '
    const assert = require("assert");
    const actual = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
    assert.deepStrictEqual(actual, JSON.parse(process.argv[2]));
  ' "$1" "$2" 2>/dev/null
}

# The lock has no entry for <name>. A missing lock file counts as no entry.
lock_lacks() {  # lock_lacks <lock-file> <name>
  [ ! -e "$1" ] || node -e '
    const lock = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
    process.exit(lock.plugins && process.argv[2] in lock.plugins ? 1 : 0);
  ' "$1" "$2" 2>/dev/null
}

# <link> is a symlink that resolves to the physical directory <dir>.
links_to() {  # links_to <link> <dir>
  [ -L "$1" ] && [ "$(cd -P -- "$1" 2>/dev/null && pwd -P)" = "$(cd -P -- "$2" && pwd -P)" ]
}

# npm stub: records each call (arguments and working directory), installs nothing.
mkdir -p "$TMP/bin"
cat > "$TMP/bin/npm" <<STUB
#!/usr/bin/env bash
echo "npm \$* (cwd=\$(pwd -P))" >> "$TMP/npm.log"
STUB
chmod +x "$TMP/bin/npm"

# run_sync <home> <log> <skills-dir> [flags...]
run_sync() {
  local home="$1" log="$2" skills="$3"
  shift 3
  env -i HOME="$home" PATH="$TMP/bin:$PATH" WAYNE_SKILLS_DIR="$skills" \
    WAYNE_HOME="$home/.wayne" WAYNE_CONFIG="$home/.wayne/config.env" \
    bash "$SYNC" "$@" >"$log" 2>&1
}

# The fixture checkout: the one plugin package, plus the global-rules file the script
# links first. m365 starts without node_modules, so a real run reaches the npm stub.
FIX="$TMP/fixture"
mkdir -p "$FIX/pi-config/extensions/m365"
echo '{"name":"pi-ext-m365"}' > "$FIX/pi-config/extensions/m365/package.json"
: > "$FIX/CLAUDE.md"

# A. The lock holds a disabled unrelated plugin and settings. Two runs link m365 and
#    enable it once, and leave the rest of the lock alone.
HOME_A="$TMP/home-a"
LOCK_A="$HOME_A/.omp/plugins/omp-plugins.lock.json"
mkdir -p "$(dirname "$LOCK_A")"
echo '{"plugins":{"pi-ext-slai":{"enabled":false}},"settings":{"x":1}}' > "$LOCK_A"
run_sync "$HOME_A" "$TMP/a1.log" "$FIX"
run_sync "$HOME_A" "$TMP/a2.log" "$FIX"
expect "A: first run prints no ERROR" log_lacks "$TMP/a1.log" "ERROR:"
expect "A: second run prints no ERROR" log_lacks "$TMP/a2.log" "ERROR:"
expect "A: pi-ext-m365 link points at the checkout's m365 dir" \
  links_to "$HOME_A/.omp/plugins/node_modules/pi-ext-m365" "$FIX/pi-config/extensions/m365"
expect "A: pi-ext-m365 enabled once, pi-ext-slai still disabled, settings.x still 1" \
  lock_is "$LOCK_A" '{"plugins":{"pi-ext-slai":{"enabled":false},"pi-ext-m365":{"enabledFeatures":null,"enabled":true}},"settings":{"x":1}}'

# B. node_modules/pi-ext-m365 is a real directory. It is reported and left in place,
#    and the plugin is not enabled.
HOME_B="$TMP/home-b"
LINK_B="$HOME_B/.omp/plugins/node_modules/pi-ext-m365"
mkdir -p "$LINK_B"
run_sync "$HOME_B" "$TMP/b1.log" "$FIX"
expect "B: m365 conflict is reported as a real file, not a symlink" \
  log_has "$TMP/b1.log" "ERROR: ${LINK_B} is a real file, not a symlink"
expect "B: the real m365 directory is left in place" is_real_dir "$LINK_B"
expect "B: pi-ext-m365 is not enabled (no lock entry)" \
  lock_lacks "$HOME_B/.omp/plugins/omp-plugins.lock.json" pi-ext-m365

# C. A pre-existing pi-ext-m365 entry is enabled and keeps its enabledFeatures.
HOME_C="$TMP/home-c"
LOCK_C="$HOME_C/.omp/plugins/omp-plugins.lock.json"
mkdir -p "$(dirname "$LOCK_C")"
echo '{"plugins":{"pi-ext-m365":{"enabled":false,"enabledFeatures":["x"]}},"settings":{}}' > "$LOCK_C"
run_sync "$HOME_C" "$TMP/c1.log" "$FIX"
expect "C: pi-ext-m365 enabled, enabledFeatures [\"x\"] kept" \
  lock_is "$LOCK_C" '{"plugins":{"pi-ext-m365":{"enabledFeatures":["x"],"enabled":true}},"settings":{}}'

# D. --dry-run reports the npm install (m365 has no node_modules), the link and the
#    lock entry, and changes nothing on disk.
HOME_D="$TMP/home-d"
mkdir -p "$HOME_D"
find "$FIX" "$HOME_D" | sort > "$TMP/d-before.txt"
run_sync "$HOME_D" "$TMP/d1.log" "$FIX" --dry-run
find "$FIX" "$HOME_D" | sort > "$TMP/d-after.txt"
expect "D: WOULD npm install for m365 (no node_modules)" \
  log_has "$TMP/d1.log" "WOULD npm install --omit=dev in $FIX/pi-config/extensions/m365"
expect "D: WOULD link pi-ext-m365" \
  log_has "$TMP/d1.log" "WOULD ln -sfn $FIX/pi-config/extensions/m365 $HOME_D/.omp/plugins/node_modules/pi-ext-m365"
expect "D: WOULD enable pi-ext-m365 in the lock" \
  log_has "$TMP/d1.log" "WOULD enable pi-ext-m365 in $HOME_D/.omp/plugins/omp-plugins.lock.json"
expect "D: --dry-run changes nothing on disk" cmp -s "$TMP/d-before.txt" "$TMP/d-after.txt"

# E. A real run on a fresh home creates the lock with only pi-ext-m365 and runs npm in
#    m365, which has no node_modules. Once node_modules is present, npm is not run.
HOME_E="$TMP/home-e"
mkdir -p "$HOME_E"
: > "$TMP/npm.log"
run_sync "$HOME_E" "$TMP/e1.log" "$FIX"
expect "E: first run prints no ERROR" log_lacks "$TMP/e1.log" "ERROR:"
expect "E: a fresh home has no RETIRE lines" log_lacks "$TMP/e1.log" "RETIRE"
expect "E: npm install runs in m365 (no node_modules)" \
  log_has "$TMP/npm.log" "npm install --omit=dev --silent (cwd=$FIX/pi-config/extensions/m365)"
expect "E: the new lock holds only pi-ext-m365, enabled, with empty settings" \
  lock_is "$HOME_E/.omp/plugins/omp-plugins.lock.json" '{"plugins":{"pi-ext-m365":{"enabledFeatures":null,"enabled":true}},"settings":{}}'
mkdir -p "$FIX/pi-config/extensions/m365/node_modules"
: > "$TMP/npm.log"
run_sync "$HOME_E" "$TMP/e2.log" "$FIX"
expect "E: npm install is not run when m365 node_modules is present" \
  log_lacks "$TMP/npm.log" "(cwd=$FIX/pi-config/extensions/m365)"

# F. A home that ran the old sync: pi-ext-teams and pi-ext-outlook are symlinks into
#    the retired directories (gone now), each with a lock entry. One run removes both
#    links and both keys, enables pi-ext-m365, and leaves pi-ext-slai and settings alone.
HOME_F="$TMP/home-f"
NM_F="$HOME_F/.omp/plugins/node_modules"
LOCK_F="$HOME_F/.omp/plugins/omp-plugins.lock.json"
mkdir -p "$NM_F"
ln -s "$FIX/pi-config/extensions/teams" "$NM_F/pi-ext-teams"
ln -s "$FIX/pi-config/extensions/outlook" "$NM_F/pi-ext-outlook"
echo '{"plugins":{"pi-ext-slai":{"enabled":false},"pi-ext-teams":{"enabledFeatures":null,"enabled":true},"pi-ext-outlook":{"enabledFeatures":null,"enabled":true}},"settings":{"x":1}}' > "$LOCK_F"
run_sync "$HOME_F" "$TMP/f1.log" "$FIX"
expect "F: first run prints no ERROR" log_lacks "$TMP/f1.log" "ERROR:"
expect "F: pi-ext-teams symlink is removed" is_absent "$NM_F/pi-ext-teams"
expect "F: pi-ext-outlook symlink is removed" is_absent "$NM_F/pi-ext-outlook"
expect "F: RETIRE printed for both links and both lock keys" log_has_all "$TMP/f1.log" \
  "RETIRE $NM_F/pi-ext-teams" "RETIRE $NM_F/pi-ext-outlook" \
  "RETIRE pi-ext-teams from $LOCK_F" "RETIRE pi-ext-outlook from $LOCK_F"
expect "F: lock keeps pi-ext-slai and settings, drops both retired keys, enables pi-ext-m365" \
  lock_is "$LOCK_F" '{"plugins":{"pi-ext-slai":{"enabled":false},"pi-ext-m365":{"enabledFeatures":null,"enabled":true}},"settings":{"x":1}}'
expect "F: pi-ext-m365 link points at the checkout's m365 dir" \
  links_to "$NM_F/pi-ext-m365" "$FIX/pi-config/extensions/m365"
run_sync "$HOME_F" "$TMP/f2.log" "$FIX"
expect "F: a second run retires nothing" log_lacks "$TMP/f2.log" "RETIRE"

# G. --dry-run on an old home reports the retirements and the enable, and changes
#    nothing on disk or in the lock.
HOME_G="$TMP/home-g"
NM_G="$HOME_G/.omp/plugins/node_modules"
LOCK_G="$HOME_G/.omp/plugins/omp-plugins.lock.json"
mkdir -p "$NM_G"
ln -s "$FIX/pi-config/extensions/teams" "$NM_G/pi-ext-teams"
ln -s "$FIX/pi-config/extensions/outlook" "$NM_G/pi-ext-outlook"
echo '{"plugins":{"pi-ext-teams":{"enabledFeatures":null,"enabled":true},"pi-ext-outlook":{"enabledFeatures":null,"enabled":true}},"settings":{}}' > "$LOCK_G"
find "$FIX" "$HOME_G" | sort > "$TMP/g-before.txt"
run_sync "$HOME_G" "$TMP/g1.log" "$FIX" --dry-run
find "$FIX" "$HOME_G" | sort > "$TMP/g-after.txt"
expect "G: WOULD RETIRE printed for both links and both lock keys" log_has_all "$TMP/g1.log" \
  "WOULD RETIRE $NM_G/pi-ext-teams" "WOULD RETIRE $NM_G/pi-ext-outlook" \
  "WOULD RETIRE pi-ext-teams from $LOCK_G" "WOULD RETIRE pi-ext-outlook from $LOCK_G"
expect "G: WOULD enable pi-ext-m365 in the lock" \
  log_has "$TMP/g1.log" "WOULD enable pi-ext-m365 in $LOCK_G"
expect "G: --dry-run changes nothing on disk" cmp -s "$TMP/g-before.txt" "$TMP/g-after.txt"
expect "G: --dry-run leaves the lock unchanged" \
  lock_is "$LOCK_G" '{"plugins":{"pi-ext-teams":{"enabledFeatures":null,"enabled":true},"pi-ext-outlook":{"enabledFeatures":null,"enabled":true}},"settings":{}}'

# H. A real directory named pi-ext-teams is reported and left in place, and so is its
#    lock key. The pi-ext-outlook symlink is still retired, and m365 is enabled.
HOME_H="$TMP/home-h"
NM_H="$HOME_H/.omp/plugins/node_modules"
LOCK_H="$HOME_H/.omp/plugins/omp-plugins.lock.json"
mkdir -p "$NM_H/pi-ext-teams"
ln -s "$FIX/pi-config/extensions/outlook" "$NM_H/pi-ext-outlook"
echo '{"plugins":{"pi-ext-teams":{"enabledFeatures":null,"enabled":true},"pi-ext-outlook":{"enabledFeatures":null,"enabled":true}},"settings":{}}' > "$LOCK_H"
run_sync "$HOME_H" "$TMP/h1.log" "$FIX"
expect "H: real pi-ext-teams directory is reported as not a symlink" \
  log_has "$TMP/h1.log" "ERROR: ${NM_H}/pi-ext-teams is not a symlink; retired plugin pi-ext-teams is left in place"
expect "H: the real pi-ext-teams directory is left in place" is_real_dir "$NM_H/pi-ext-teams"
expect "H: pi-ext-outlook symlink is removed" is_absent "$NM_H/pi-ext-outlook"
expect "H: lock keeps the pi-ext-teams key, drops pi-ext-outlook, enables pi-ext-m365" \
  lock_is "$LOCK_H" '{"plugins":{"pi-ext-teams":{"enabledFeatures":null,"enabled":true},"pi-ext-m365":{"enabledFeatures":null,"enabled":true}},"settings":{}}'

# I. A retired lock key whose link is already gone is still deleted, because the entry
#    would name nothing.
HOME_I="$TMP/home-i"
LOCK_I="$HOME_I/.omp/plugins/omp-plugins.lock.json"
mkdir -p "$(dirname "$LOCK_I")"
echo '{"plugins":{"pi-ext-outlook":{"enabledFeatures":null,"enabled":true}},"settings":{}}' > "$LOCK_I"
run_sync "$HOME_I" "$TMP/i1.log" "$FIX"
expect "I: RETIRE printed for the stale pi-ext-outlook lock key" \
  log_has "$TMP/i1.log" "RETIRE pi-ext-outlook from $LOCK_I"
expect "I: the lock keeps only pi-ext-m365" \
  lock_is "$LOCK_I" '{"plugins":{"pi-ext-m365":{"enabledFeatures":null,"enabled":true}},"settings":{}}'

echo
if [ "$FAILS" -eq 0 ]; then
  echo "RESULT: PASS"
else
  echo "RESULT: FAIL (${FAILS})"
  exit 1
fi
