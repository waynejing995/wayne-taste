#!/usr/bin/env bash
set -euo pipefail

if [[ $# -ne 3 ]]; then
    echo "usage: $0 <complete|gstack-ban|conflict> <skill-dir> <workspace>" >&2
    exit 2
fi

case_name=$1
skill_dir=$(realpath "$2")
workspace=$(realpath -m "$3")
harness=$(cd "$(dirname "$0")" && pwd)

[[ -f "$harness/cases/$case_name/case.md" ]] || {
    echo "unknown case: $case_name" >&2
    exit 2
}
[[ -f "$skill_dir/SKILL.md" ]] || {
    echo "missing skill: $skill_dir/SKILL.md" >&2
    exit 2
}
[[ ! -e "$workspace" ]] || {
    echo "workspace already exists: $workspace" >&2
    exit 2
}

mkdir -p "$workspace/repo" "$workspace/skill" "$workspace/support"
cp -a "$harness/fixture/." "$workspace/repo/"
cp "$harness/cases/$case_name/case.md" "$workspace/repo/case.md"
cp "$skill_dir/SKILL.md" "$workspace/skill/SKILL.md"
cp "$harness/trial-task.md" "$workspace/task.md"
cp -a "$harness/support/." "$workspace/support/"

git -C "$workspace/repo" init -q
git -C "$workspace/repo" config user.name "Eval Fixture"
git -C "$workspace/repo" config user.email "eval@example.invalid"
git -C "$workspace/repo" add .
git -C "$workspace/repo" commit -q -m "fixture: initial design context"
