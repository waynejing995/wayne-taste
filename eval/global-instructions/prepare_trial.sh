#!/usr/bin/env bash
set -euo pipefail

if [[ $# -ne 3 ]]; then
    echo "usage: $0 <case> <instructions.md> <workspace>" >&2
    exit 2
fi

case_name=$1
instructions=$(realpath "$2")
workspace=$(realpath -m "$3")
harness=$(cd "$(dirname "$0")" && pwd)
case_dir="$harness/cases/$case_name"

[[ -f "$instructions" ]] || { echo "missing instructions: $instructions" >&2; exit 2; }
[[ -f "$case_dir/task.md" ]] || { echo "unknown case: $case_name" >&2; exit 2; }
[[ -d "$case_dir/repo" ]] || { echo "missing case repository: $case_name" >&2; exit 2; }
[[ ! -e "$workspace" ]] || { echo "workspace already exists: $workspace" >&2; exit 2; }

mkdir -p "$workspace/repo"
cp -R "$case_dir/repo/." "$workspace/repo/"
cp "$case_dir/task.md" "$workspace/task.md"
cp "$instructions" "$workspace/instructions.md"
cp -R "$harness/fixture-skill" "$workspace/fixture-skill"
printf '%s\n' "$case_name" > "$workspace/case-name"
sha256sum "$workspace/instructions.md" | cut -d' ' -f1 > "$workspace/instructions.sha256"

git -C "$workspace/repo" init -q
git -C "$workspace/repo" config user.name "Eval Fixture"
git -C "$workspace/repo" config user.email "eval@example.invalid"
git -C "$workspace/repo" add .
git -C "$workspace/repo" commit -q -m "fixture: base"
git -C "$workspace/repo" branch -M main
git -C "$workspace/repo" config user.name "Build Robot"
git -C "$workspace/repo" config user.email "robot@example.invalid"

candidate_sha=$(sha256sum "$workspace/instructions.md" | cut -d' ' -f1)
task_sha=$(sha256sum "$workspace/task.md" | cut -d' ' -f1)
base_tree=$(git -C "$workspace/repo" rev-parse 'HEAD^{tree}')
harness_sha=$(cut -d' ' -f1 "$harness/harness.sha256")
workspace_id=$(printf '%s' "$workspace" | sha256sum | cut -d' ' -f1)
jq -n \
    --arg case "$case_name" \
    --arg candidate_sha256 "$candidate_sha" \
    --arg task_sha256 "$task_sha" \
    --arg base_tree "$base_tree" \
    --arg harness_sha256 "$harness_sha" \
    --arg workspace_id "$workspace_id" \
    --arg workspace_path "$workspace" \
    '{case:$case,candidate_sha256:$candidate_sha256,task_sha256:$task_sha256,
      base_tree:$base_tree,harness_sha256:$harness_sha256,
      workspace_id:$workspace_id,workspace_path:$workspace_path}' \
    > "$workspace/input-manifest.json"
