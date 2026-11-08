#!/usr/bin/env bash
# Downstream proof for a bug-fix goal: a fresh executor runs the generated goal in a
# scratch copy of the pre-fix repo, then proof.sh checks its tests fail before and
# pass after the fix.
# usage: downstream.sh <writer-trial-dir> <out-dir> <claude|codex> <model>
set -euo pipefail

trial=$(realpath "$1")
out=$(realpath -m "$2")
agent=$3
model=$4
harness=$(cd "$(dirname "$0")" && pwd)
tree=$(realpath "$harness/../.runs/goal-prompt-test-bar/candidate-tree")  # skill text is irrelevant here
case_name=$(basename "$trial" | cut -d. -f1)

bash "$harness/prepare_trial.sh" "$case_name" "$tree" "$out" > /dev/null
rm -rf "$out/skill" "$out/_shared"
{
    printf 'You are the executor. The goal below is already confirmed and the cwd is /srv/tasks: execute it now, end to end, without asking for confirmation.\n'
    printf 'Wayne skills are not installed; where the goal names one, follow its intent with ordinary engineering practice.\n'
    printf 'systemd, GitHub, and Teams are unreachable here; where the goal needs them, say so in your final message instead.\n'
    printf 'Use `uv run --no-project --with pytest ...` style commands. Do not commit.\n\n'
    (cd "$harness" && uv run --quiet --no-project python -c 'import sys; from check_trial import goal_block; print(goal_block(open(sys.argv[1]).read()))' "$trial/final.md")
} > "$out/task.md"
if [[ -n ${PROOF_ONLY_PATCH:-} ]]; then  # calibration: apply a known fix instead of running an executor
    mkdir -p "$out.state/cache"
    git -C "$out/fs/tasks" apply "$PROOF_ONLY_PATCH"
else
    MODEL=$model EFFORT=high timeout 2400 bash "$harness/run_agent.sh" "$agent" "$case_name" "$out" "$out.state" > "$out.run.log" 2>&1 || echo "executor exit $?" >> "$out.run.log"
fi
bash "$harness/proof.sh" "$out"
