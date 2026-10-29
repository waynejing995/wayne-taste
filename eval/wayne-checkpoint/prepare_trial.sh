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

[[ -f "$harness/cases/$case_name/case.md" ]] || { echo "unknown case: $case_name" >&2; exit 2; }
[[ -f "$skill_dir/SKILL.md" ]] || { echo "missing skill: $skill_dir/SKILL.md" >&2; exit 2; }
[[ ! -e "$workspace" ]] || { echo "workspace already exists: $workspace" >&2; exit 2; }

mkdir -p "$workspace/repo" "$workspace/skill" "$workspace/support" "$workspace/_shared/scripts" "$workspace/wayne-home"
# Repository content only: the fixture and the case, minus their seeded wayne-home/.
for source in "$harness/fixture" "$harness/cases/$case_name"; do
    find "$source" -mindepth 1 -maxdepth 1 ! -name wayne-home -exec cp -a -t "$workspace/repo/" -- {} +
done
# Seeded Wayne state goes straight to WAYNE_HOME beside repo/, never into it.
for seed in "$harness/fixture/wayne-home" "$harness/cases/$case_name/wayne-home"; do
    if [[ -d "$seed" ]]; then
        cp -a "$seed/." "$workspace/wayne-home/"
    fi
done
cp -a "$skill_dir/." "$workspace/skill/"
cp -a "$harness/support/." "$workspace/support/"
cp "$repo_root/_shared/pipeline-id-contract.md" "$workspace/_shared/"
cp "$repo_root/_shared/scripts/wayne-state-dir.sh" "$workspace/_shared/scripts/"
cp "$harness/trial-task.md" "$workspace/task.md"

git -C "$workspace/repo" init -q
git -C "$workspace/repo" config user.name "Eval Fixture"
git -C "$workspace/repo" config user.email "eval@example.invalid"
git -C "$workspace/repo" add -f .
git -C "$workspace/repo" commit -q -m "fixture: checkpoint inputs"
