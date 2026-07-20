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
repo_root=$(cd "$harness/../.." && pwd)
case_dir="$harness/cases/$case_name"

[[ -f "$skill_dir/SKILL.md" ]] || { echo "missing skill: $skill_dir" >&2; exit 2; }
[[ -f "$case_dir/task.md" ]] || { echo "unknown case: $case_name" >&2; exit 2; }
[[ -d "$case_dir/repo" ]] || { echo "missing case repo: $case_name" >&2; exit 2; }
[[ ! -e "$workspace" ]] || { echo "workspace exists: $workspace" >&2; exit 2; }

mkdir -p "$workspace/repo" "$workspace/skill" "$workspace/_shared" "$workspace/support"
cp -R "$case_dir/repo/." "$workspace/repo/"
cp -R "$skill_dir/." "$workspace/skill/"
cp "$repo_root/_shared/e2e-contract.md" "$workspace/_shared/e2e-contract.md"
cp "$repo_root/_shared/pipeline-id-contract.md" "$workspace/_shared/pipeline-id-contract.md"
cp -R "$repo_root/wayne-checkpoint" "$workspace/support/wayne-checkpoint"
cp "$case_dir/task.md" "$workspace/task.md"

git -C "$workspace/repo" init -q
git -C "$workspace/repo" config user.name "Eval Fixture"
git -C "$workspace/repo" config user.email "eval@example.invalid"
git -C "$workspace/repo" add .
git -C "$workspace/repo" commit -q -m "fixture: base"
git -C "$workspace/repo" branch -M main
