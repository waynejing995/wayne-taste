#!/usr/bin/env bash
# Materialize one wayne-work wave trial under /tmp (local fs, so inotify sees reads).
#   control   = wayne-work at git HEAD (no S node), no wayne-simplify available
#   candidate = working-tree wayne-work (with S) + wayne-simplify
# usage: prepare_wave.sh <arm>   -> prints the workspace root
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
sot="$(cd "$here/../.." && pwd)"
arm="$1"
ws="/tmp/wayne-simplify-wave/$arm"

rm -rf "$ws"
mkdir -p "$ws/skill"
cp -r "$here/cases/work-wave/repo" "$ws/repo"
cp -r "$sot/_shared" "$ws/skill/_shared"

mkdir -p "$ws/skill/wayne-work"
cp -r "$sot/wayne-work/references" "$ws/skill/wayne-work/references"
if [ "$arm" = "control" ]; then
  git -C "$sot" show HEAD:wayne-work/SKILL.md > "$ws/skill/wayne-work/SKILL.md"
else
  cp "$sot/wayne-work/SKILL.md" "$ws/skill/wayne-work/SKILL.md"
  cp -r "$sot/wayne-simplify" "$ws/skill/wayne-simplify"
fi

git -C "$ws/repo" init -q
git -C "$ws/repo" add -A
echo "$ws"
