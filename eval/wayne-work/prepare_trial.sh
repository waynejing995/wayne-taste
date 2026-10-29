#!/usr/bin/env bash
set -euo pipefail

if [[ $# -ne 3 ]]; then
    echo "usage: $0 <normal|protected|missing-u|parallel-disjoint> <skill-dir> <workspace>" >&2
    exit 2
fi

case_name=$1
skill_dir=$(realpath "$2")
workspace=$(realpath -m "$3")
harness=$(cd "$(dirname "$0")" && pwd)
repo_root=$(cd "$harness/../.." && pwd)

[[ -d "$harness/cases/$case_name" ]] || { echo "unknown case: $case_name" >&2; exit 2; }
[[ -f "$skill_dir/SKILL.md" ]] || { echo "missing skill: $skill_dir/SKILL.md" >&2; exit 2; }
[[ ! -e "$workspace" ]] || { echo "workspace already exists: $workspace" >&2; exit 2; }

mkdir -p "$workspace/repo" "$workspace/skill" "$workspace/support" "$workspace/_shared/scripts" "$workspace/wayne-home"
# Approved plans and test matrices are project state under WAYNE_HOME, beside repo/. Copy
# repo inputs with wayne-home excluded so no state file can enter the committed repository.
(cd "$harness/fixture" && tar --exclude=./wayne-home -cf - .) | tar -xf - -C "$workspace/repo"
(cd "$harness/cases/$case_name" && tar --exclude=./wayne-home -cf - .) | tar -xf - -C "$workspace/repo"
for seeded in "$harness/fixture/wayne-home" "$harness/cases/$case_name/wayne-home"; do
    if [[ -d "$seeded" ]]; then cp -a "$seeded/." "$workspace/wayne-home/"; fi
done
cp "$repo_root/_shared/pipeline-id-contract.md" "$workspace/_shared/"
cp "$repo_root/_shared/scripts/wayne-state-dir.sh" "$workspace/_shared/scripts/"
cp -a "$skill_dir/." "$workspace/skill/"
cp "$harness/trial-task.md" "$workspace/task.md"
cp -a "$harness/support/." "$workspace/support/"
find "$workspace" -type d -name __pycache__ -prune -exec rm -rf {} +

git -C "$workspace/repo" init -q
git -C "$workspace/repo" config user.name "Eval Fixture"
git -C "$workspace/repo" config user.email "eval@example.invalid"
git -C "$workspace/repo" add .
git -C "$workspace/repo" commit -q -m "fixture: approved retry plan"
git -C "$workspace/repo" branch -M main
