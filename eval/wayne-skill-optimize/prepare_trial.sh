#!/usr/bin/env bash
set -euo pipefail

if [[ $# -ne 2 ]]; then
    echo "usage: $0 <optimizer-dir> <workspace>" >&2
    exit 2
fi

optimizer=$(realpath "$1")
workspace=$(realpath -m "$2")
harness=$(cd "$(dirname "$0")" && pwd)
repo_root=$(realpath "$harness/../..")

[[ -f "$optimizer/SKILL.md" ]] || { echo "missing optimizer SKILL.md" >&2; exit 2; }
[[ -f "$repo_root/wayne-skill-forge/SKILL.md" ]] || { echo "missing wayne-skill-forge" >&2; exit 2; }
[[ ! -e "$workspace" ]] || { echo "workspace already exists: $workspace" >&2; exit 2; }

mkdir -p "$workspace/optimizer" "$workspace/repo/decision-builder" "$workspace/repo/.eval"
cp -a "$optimizer/." "$workspace/optimizer/"
cp -a "$repo_root/wayne-skill-forge" "$workspace/wayne-skill-forge"
cp "$harness/fixture/initial-SKILL.md" "$workspace/repo/decision-builder/SKILL.md"
cp "$harness/task.md" "$workspace/task.md"

git -C "$workspace/repo" init -q
git -C "$workspace/repo" config user.name "Eval Fixture"
git -C "$workspace/repo" config user.email "eval@example.invalid"
git -C "$workspace/repo" add decision-builder/SKILL.md
git -C "$workspace/repo" commit -q -m "feat: create durable decision builder"
git -C "$workspace/repo" rev-parse HEAD > "$workspace/repo/.eval/initial-commit"

cp "$harness/fixture/current-SKILL.md" "$workspace/repo/decision-builder/SKILL.md"
cp "$harness/fixture/policy.md" "$workspace/repo/policy.md"
cp "$harness/fixture/usage-feedback.md" "$workspace/repo/usage-feedback.md"
git -C "$workspace/repo" add decision-builder/SKILL.md policy.md usage-feedback.md
git -C "$workspace/repo" commit -q -m "refactor: slim decision builder and record policy"
git -C "$workspace/repo" branch -M main
