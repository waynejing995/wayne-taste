#!/usr/bin/env bash
set -euo pipefail

if [[ $# -ne 3 ]]; then
    echo "usage: $0 <case> <skill-dir> <workspace>" >&2
    exit 2
fi

case_name=$1
skill_dir=$(realpath "$2")
workspace=$(realpath -m "$3")
harness=$(cd "$(dirname "$0")" && pwd)
case_dir="$harness/cases/$case_name"

[[ -f "$skill_dir/SKILL.md" ]] || { echo "missing skill: $skill_dir/SKILL.md" >&2; exit 2; }
[[ -d "$case_dir" ]] || { echo "unknown case: $case_name" >&2; exit 2; }
[[ -f "$case_dir/task.md" ]] || { echo "missing case task: $case_dir/task.md" >&2; exit 2; }
[[ ! -e "$workspace" ]] || { echo "workspace already exists: $workspace" >&2; exit 2; }

mkdir -p "$workspace/repo" "$workspace/skill" "$workspace/support"
if [[ -d "$case_dir/base" ]]; then
    cp -R "$case_dir/base/." "$workspace/repo/"
    cp "$case_dir/AGENTS.md" "$case_dir/case.md" "$workspace/repo/"
else
    cp -R "$case_dir/." "$workspace/repo/"
fi
cp -R "$skill_dir/." "$workspace/skill/"
cp "$case_dir/task.md" "$workspace/task.md"

git -C "$workspace/repo" init -q
git -C "$workspace/repo" config user.name "Eval Fixture"
git -C "$workspace/repo" config user.email "eval@example.invalid"
git -C "$workspace/repo" add .
git -C "$workspace/repo" commit -q -m "fixture: frozen review base"
git -C "$workspace/repo" branch -M main
git clone -q --bare "$workspace/repo" "$workspace/support/origin.git"
git -C "$workspace/repo" remote add origin "$workspace/support/origin.git"
git -C "$workspace/repo" fetch -q origin main
if [[ -d "$case_dir/overlay" ]]; then
    cp -R "$case_dir/overlay/." "$workspace/repo/"
fi

git -C "$workspace/repo" status --porcelain=v1 --untracked-files=all \
  > "$workspace/repo-start-status.txt"
git -C "$workspace/repo" diff --binary --full-index HEAD -- \
  | sha256sum | cut -d' ' -f1 > "$workspace/repo-start-diff.sha256"
