#!/usr/bin/env bash
set -euo pipefail
[[ $# -eq 3 ]] || { echo "usage: $0 <case> <skill-dir> <workspace>" >&2; exit 2; }
case_name=$1; skill_dir=$(realpath "$2"); workspace=$(realpath -m "$3")
harness=$(cd "$(dirname "$0")" && pwd); repo_root=$(cd "$harness/../.." && pwd)
case_dir="$harness/cases/$case_name"
[[ -f "$skill_dir/SKILL.md" && -f "$case_dir/task.md" ]] || exit 2
[[ ! -e "$workspace" ]] || { echo "workspace exists: $workspace" >&2; exit 2; }
# Wayne state lives under WAYNE_HOME, beside repo/, never inside it.
mkdir -p "$workspace/repo" "$workspace/skill" "$workspace/_shared/scripts" "$workspace/wayne-home/projects/repo"
cp -R "$case_dir/repo/." "$workspace/repo/"
cp -R "$skill_dir/." "$workspace/skill/"
cp "$repo_root/_shared/e2e-contract.md" "$repo_root/_shared/pipeline-id-contract.md" "$workspace/_shared/"
cp "$repo_root/_shared/scripts/wayne-state-dir.sh" "$workspace/_shared/scripts/"
cp "$case_dir/task.md" "$workspace/task.md"
git -C "$workspace/repo" init -q
git -C "$workspace/repo" config user.name "Eval Fixture"
git -C "$workspace/repo" config user.email "eval@example.invalid"
git -C "$workspace/repo" add . && git -C "$workspace/repo" commit -q -m "fixture: base"
git -C "$workspace/repo" branch -M main
