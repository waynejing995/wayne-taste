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
checkpoint_dir="$repo_root/wayne-checkpoint"

[[ -d "$harness/cases/$case_name" ]] || { echo "unknown case: $case_name" >&2; exit 2; }
[[ -f "$skill_dir/SKILL.md" ]] || { echo "missing skill: $skill_dir/SKILL.md" >&2; exit 2; }
[[ -f "$checkpoint_dir/SKILL.md" ]] || { echo "missing checkpoint Skill" >&2; exit 2; }
[[ ! -e "$workspace" ]] || { echo "workspace already exists: $workspace" >&2; exit 2; }

expected_checkpoint=$(cut -d' ' -f1 "$harness/checkpoint.sha256")
actual_checkpoint=$(
    cd "$repo_root"
    find wayne-checkpoint -type f -print0 | sort -z | xargs -0 sha256sum | sha256sum | cut -d' ' -f1
)
[[ "$actual_checkpoint" == "$expected_checkpoint" ]] || {
    echo "checkpoint dependency drift: expected=$expected_checkpoint actual=$actual_checkpoint" >&2
    exit 2
}

mkdir -p "$workspace/repo" "$workspace/skill" "$workspace/support"
cp -a "$harness/fixture/." "$workspace/repo/"
cp -a "$harness/cases/$case_name/." "$workspace/repo/"
cp -a "$skill_dir/." "$workspace/skill/"
cp "$harness/trial-task.md" "$workspace/task.md"
cp -a "$harness/support/." "$workspace/support/"
cp -a "$checkpoint_dir" "$workspace/support/wayne-checkpoint"

git -C "$workspace/repo" init -q
git -C "$workspace/repo" config user.name "Eval Fixture"
git -C "$workspace/repo" config user.email "eval@example.invalid"
git -C "$workspace/repo" add .
git -C "$workspace/repo" commit -q -m "fixture: triage inputs"
