#!/usr/bin/env bash
set -euo pipefail

if [[ $# -ne 2 ]]; then
    echo "usage: $0 <skill-dir> <workspace>" >&2
    exit 2
fi

skill_dir=$(realpath "$1")
workspace=$(realpath -m "$2")
harness=$(cd "$(dirname "$0")" && pwd)
repo_root=$(cd "$harness/../.." && pwd)

[[ -f "$skill_dir/SKILL.md" ]] || { echo "missing Plan skill" >&2; exit 2; }
[[ ! -e "$workspace" ]] || { echo "workspace exists: $workspace" >&2; exit 2; }

mkdir -p "$workspace/repo" "$workspace/skill" "$workspace/repo/_shared"
cp -R "$harness/cases/normal/." "$workspace/repo/"
cp -R "$skill_dir/." "$workspace/skill/"
cp "$repo_root/_shared/pipeline-id-contract.md" "$workspace/repo/_shared/"
cp "$harness/intent-regression-task.md" "$workspace/task.md"

git -C "$workspace/repo" init -q
git -C "$workspace/repo" config user.name "Eval Fixture"
git -C "$workspace/repo" config user.email "eval@example.invalid"
git -C "$workspace/repo" add .
git -C "$workspace/repo" commit -q -m "fixture: plan intent inputs"
git -C "$workspace/repo" branch -M main
