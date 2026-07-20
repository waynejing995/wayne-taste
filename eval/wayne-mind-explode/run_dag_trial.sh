#!/usr/bin/env bash
set -euo pipefail

[[ $# -eq 3 ]] || { echo "usage: $0 <claude|codex> <workspace> <state-root>" >&2; exit 2; }
agent=$1
workspace=$(realpath "$2")
state_root=$(realpath -m "$3")
harness=$(cd "$(dirname "$0")" && pwd)

for turn in 1 2 3; do
    cp "$harness/cases/dag-iteration/task-turn-$turn.md" "$workspace/task.md"
    MODEL=${MODEL:?} EFFORT=${EFFORT:?} bash "$harness/run_trace_agent.sh" \
        "$agent" "$workspace" "$state_root/turn-$turn"
    if [[ "$agent" = claude ]]; then
        cp "$workspace/claude-result.json" "$workspace/turn-$turn-output.json"
        cp "$workspace/claude-trace.jsonl" "$workspace/turn-$turn-trace.jsonl"
    else
        cp "$workspace/codex-final.txt" "$workspace/turn-$turn-output.txt"
        cp "$workspace/codex-trace.log" "$workspace/turn-$turn-trace.log"
    fi
    mapfile -t logs < <(find "$workspace/repo/docs/decisions" -maxdepth 1 -type f -name '*-decisions.md' 2>/dev/null | sort)
    [[ ${#logs[@]} -eq 1 ]] || { echo "turn $turn expected one decision log" >&2; exit 1; }
    cp "${logs[0]}" "$workspace/turn-$turn-decision-log.md"
done
