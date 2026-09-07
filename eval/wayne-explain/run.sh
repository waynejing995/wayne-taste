#!/usr/bin/env bash
set -euo pipefail

if [[ $# -ne 2 ]]; then
    echo "usage: $0 <skill-directory> <fresh-output-directory>" >&2
    exit 2
fi
: "${MODEL:?set MODEL}"
: "${EFFORT:?set EFFORT}"

harness=$(cd "$(dirname "$0")" && pwd)
skill=$(realpath "$1")
output=$(realpath -m "$2")
mkdir "$output"
printf 'MODEL=%s\nEFFORT=%s\n' "$MODEL" "$EFFORT" > "$output/settings.txt"
sha256sum "$skill/SKILL.md" "$harness/README.md" "$harness/cases.json" "$harness/triggers.md" "$harness/run.sh" > "$output/inputs.sha256"

pids=()
mapfile -t cases < <(jq -r '.[].id' "$harness/cases.json")
for id in "${cases[@]}"; do
    workspace="$output/$id"
    mkdir -p "$workspace/wayne-explain"
    cp "$skill/SKILL.md" "$workspace/wayne-explain/SKILL.md"
    printf 'Use the skill at /workspace/wayne-explain/SKILL.md to answer the following conversation. Return only the reply to the user. Do not modify files or use external sources.\n\n' > "$workspace/task.md"
    jq -r --arg id "$id" '.[] | select(.id == $id) | .task' "$harness/cases.json" >> "$workspace/task.md"
    bash "$harness/../run_isolated_agent.sh" codex "$workspace" "$output/state-$id" > "$output/$id-runner.log" 2>&1 &
    pids+=("$!")
done

workspace="$output/triggers"
mkdir "$workspace"
cp "$harness/triggers.md" "$workspace/task.md"
printf '\nSkill metadata:\n\n' >> "$workspace/task.md"
# Both frozen versions use a four-line YAML frontmatter block.
head -n 4 "$skill/SKILL.md" >> "$workspace/task.md"
bash "$harness/../run_isolated_agent.sh" codex "$workspace" "$output/state-triggers" > "$output/triggers-runner.log" 2>&1 &
pids+=("$!")

status=0
for pid in "${pids[@]}"; do
    wait "$pid" || status=1
done
sha256sum --check "$output/inputs.sha256" || status=1
if [[ "$status" -ne 0 ]]; then
    echo "Trial failed; inspect runner logs and codex traces under $output" >&2
    exit "$status"
fi
printf 'Trial finished: %s\n' "$output"
