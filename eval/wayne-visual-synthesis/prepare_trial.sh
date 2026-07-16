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

[[ -f "$harness/cases/$case_name/task.md" ]] || { echo "unknown case: $case_name" >&2; exit 2; }
[[ -f "$skill_dir/SKILL.md" ]] || { echo "missing skill: $skill_dir/SKILL.md" >&2; exit 2; }
[[ ! -e "$workspace" ]] || { echo "workspace already exists: $workspace" >&2; exit 2; }

mkdir -p "$workspace/skill" "$workspace/images" "$workspace/output"
cp -a "$skill_dir/." "$workspace/skill/"
cp "$harness/cases/$case_name/task.md" "$workspace/task.md"
uv run "$harness/generate_fixtures.py" "$workspace/images"
