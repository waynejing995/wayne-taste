#!/usr/bin/env bash
set -euo pipefail

if [[ $# -ne 2 ]]; then
    echo "usage: $0 <skill-dir> <workspace>" >&2
    exit 2
fi

skill_dir=$(realpath "$1")
workspace=$(realpath -m "$2")
harness=$(cd "$(dirname "$0")" && pwd)

[[ -f "$skill_dir/SKILL.md" ]] || { echo "missing Forge skill" >&2; exit 2; }
[[ ! -e "$workspace" ]] || { echo "workspace exists: $workspace" >&2; exit 2; }

mkdir -p "$workspace/skill" "$workspace/child"
cp -R "$skill_dir/." "$workspace/skill/"
cp -R "$harness/flow-case/child/." "$workspace/child/"
cp "$harness/flow-case/task.md" "$workspace/task.md"
