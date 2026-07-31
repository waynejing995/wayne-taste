#!/usr/bin/env bash
# Bootstrap a fresh machine's pi setup from this SoT.
#
# 1. install every pi package listed in the shipped settings.json
# 2. symlink shipped config into ~/.pi/agent (via sync.sh)
# 3. remind about the manual step: internal model provider + secret
#
# Assumes `pi` is already installed and on PATH.
# Usage:  bash "${WAYNE_SKILLS_DIR}/pi-config/bootstrap.sh"
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
SETTINGS="${SOT}/settings.json"

command -v pi >/dev/null 2>&1 || { echo "ERROR: 'pi' not on PATH — install pi first."; exit 1; }
[ -f "$SETTINGS" ] || { echo "ERROR: missing ${SETTINGS}"; exit 1; }

echo "=== 1. install pi packages from settings.json ==="
# Parse the packages[] array without jq (python3 is assumed available).
mapfile -t PKGS < <(python3 -c "import json,sys; print('\n'.join(json.load(open('${SETTINGS}')).get('packages',[])))")
if [ "${#PKGS[@]}" -eq 0 ]; then
  echo "WARN: no packages listed in settings.json"
else
  for p in "${PKGS[@]}"; do
    echo "--- pi install ${p} ---"
    pi install "${p}" || echo "WARN: failed to install ${p} (continuing)"
  done
fi

echo
echo "=== 2. symlink config (sync.sh) ==="
bash "${SOT}/sync.sh"

echo
echo "=== 3. MANUAL steps remaining ==="
echo " - Internal model provider: follow ${SOT}/internal-models-setup.md"
echo "   (create ~/.pi/agent/models.json; set the APIM key via env/secret manager)."
echo " - Optional machine-local extras not shipped: ~/.pi/agent/extensions/*,"
echo "   ~/.tmux.conf — copy by hand if you want them."
echo
echo "Then start pi. Verify:  pi --list-models | grep -E 'Claude-Opus-4.8|gpt-5.6'"
