#!/usr/bin/env bash
# Build one isolated writer workspace: skill snapshot, shared contract, task, and a
# frozen fixture filesystem that run_agent.sh binds onto the real absolute paths.
set -euo pipefail

if [[ $# -ne 3 ]]; then
    echo "usage: $0 <case> <tree-dir containing wayne-goal-prompt/ and _shared/> <workspace>" >&2
    exit 2
fi

case_name=$1
tree=$(realpath "$2")
workspace=$(realpath -m "$3")
harness=$(cd "$(dirname "$0")" && pwd)
inputs=$(realpath "$harness/../.runs/goal-prompt-test-bar/inputs")
case_dir="$harness/cases/$case_name"

[[ -f $tree/wayne-goal-prompt/SKILL.md && -f $tree/_shared/task-prompt.md ]] || { echo "bad tree: $tree" >&2; exit 2; }
[[ -f $case_dir/task.md ]] || { echo "unknown case: $case_name" >&2; exit 2; }
[[ ! -e $workspace ]] || { echo "workspace exists: $workspace" >&2; exit 2; }
(cd "$inputs" && sha256sum --quiet -c ../inputs.sha256) || { echo "frozen inputs changed" >&2; exit 2; }

mkdir -p "$workspace/skill" "$workspace/_shared" "$workspace/fs/wayne-home/projects"
cp -R "$tree/wayne-goal-prompt/." "$workspace/skill/"
cp "$tree/_shared/task-prompt.md" "$workspace/_shared/"
cp "$case_dir/task.md" "$workspace/task.md"

git_snapshot() {  # <tar> <dest>
    mkdir -p "$2"
    tar -xf "$1" -C "$2"
    git -C "$2" init -q
    git -C "$2" config user.name "Eval Fixture"
    git -C "$2" config user.email "eval@example.invalid"
    git -C "$2" add -A
    git -C "$2" commit -q -m "fixture: base"
}

repo="$workspace/fs/tasks"
case $case_name in
    feature-review-parallel)
        git_snapshot "$inputs/feature-base.tar" "$repo"
        git -C "$repo" apply "$inputs/feature-wip.patch"
        cp -R "$inputs/feature-untracked/." "$repo/"
        mkdir -p "$workspace/fs/wayne-home/projects/tasks/runs"
        ;;
    bugfix-stale-reset)
        git_snapshot "$inputs/bugfix-base.tar" "$repo"
        mkdir -p "$workspace/fs/wayne-home/projects/tasks/runs"
        ;;
    heldout-teams-markdown)
        git_snapshot "$inputs/heldout-base.tar" "$repo"
        mkdir -p "$workspace/fs/wayne-home/projects/tasks/runs"
        ;;
    monitor-preprocess)
        mkdir -p "$workspace/fs/inbox-scripts" "$workspace/fs/wayne-home/projects/trace/runs"
        cp -R "$inputs/monitor/scripts/." "$workspace/fs/inbox-scripts/"
        cp -R "$inputs/monitor/home/." "$workspace/fs/wayne-home/projects/trace/runs/"
        cp "$inputs/omp-config.yml" "$workspace/fs/omp-config.yml"
        ;;
    *)
        echo "no fixture recipe for $case_name" >&2
        exit 2
        ;;
esac

# Mutation baseline: every fixture file, including untracked and ignored ones.
(cd "$workspace/fs" && find . -path '*/.git' -prune -o -type f -print0 | sort -z | xargs -0 sha256sum) > "$workspace/fs-before.sha256"
