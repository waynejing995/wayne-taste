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

expected_harness=$(cut -d' ' -f1 "$harness/harness.sha256")
actual_harness=$(bash "$harness/freeze_harness.sh")
[[ "$actual_harness" == "$expected_harness" ]] || {
    echo "harness drift: expected=$expected_harness actual=$actual_harness" >&2
    exit 2
}

mkdir -p "$workspace/wayne-skill-optimize" "$workspace/repo/decision-builder"
cp -a "$optimizer/." "$workspace/wayne-skill-optimize/"
cp -a "$repo_root/wayne-skill-forge" "$workspace/wayne-skill-forge"
cp "$harness/fixture/initial-SKILL.md" "$workspace/repo/decision-builder/SKILL.md"
cp "$harness/task.md" "$workspace/task.md"
cp "$harness/dossier-contract.md" "$workspace/dossier-contract.md"

(cd "$optimizer" && find . -type f -print0 | sort -z | xargs -0 sha256sum | sha256sum) \
  > "$workspace/optimizer-tree.sha256"
sha256sum "$optimizer/SKILL.md" > "$workspace/optimizer-skill.sha256"

git -C "$workspace/repo" init -q
git -C "$workspace/repo" config user.name "Eval Fixture"
git -C "$workspace/repo" config user.email "eval@example.invalid"
git -C "$workspace/repo" add decision-builder/SKILL.md
git -C "$workspace/repo" commit -q -m "feat: create durable decision builder"
cp "$harness/fixture/current-SKILL.md" "$workspace/repo/decision-builder/SKILL.md"
cp "$harness/fixture/policy.md" "$workspace/repo/policy.md"
cp "$harness/fixture/usage-feedback.md" "$workspace/repo/usage-feedback.md"
cp -a "$harness/fixture/session-history" "$workspace/repo/session-history"
git -C "$workspace/repo" add decision-builder/SKILL.md policy.md usage-feedback.md session-history
git -C "$workspace/repo" commit -q -m "refactor: slim decision builder and record policy"
git -C "$workspace/repo" branch -M main
