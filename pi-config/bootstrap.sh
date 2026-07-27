#!/usr/bin/env bash
# Bootstrap a fresh machine's pi setup from this SoT.
#
# 1. install every pi package listed in the shipped settings.json
# 2. symlink shipped config into ~/.pi/agent (via sync.sh)
# 3. remind about the manual step: internal model provider + secret
#
# Assumes `pi` is already installed and on PATH.
# Usage:  bash /mnt/share/wayne-skills/pi-config/bootstrap.sh
set -euo pipefail

SOT="/mnt/share/wayne-skills/pi-config"
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
