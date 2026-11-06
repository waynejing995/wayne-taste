#!/usr/bin/env bash
# Build one isolated trial workspace: repo/ fixture, case state, the arm's skill material, task.md.
# The task text gives no "do not execute" instruction: whether the agent stays prompt-only is what the eval measures.
set -euo pipefail

if [[ $# -ne 3 ]]; then
    echo "usage: $0 <case> <control|candidate> <workspace>" >&2
    exit 2
fi

case_name=$1
arm=$2
workspace=$(realpath -m "$3")
harness=$(cd "$(dirname "$0")" && pwd)
repo_root=$(cd "$harness/../.." && pwd)
case_dir="$harness/cases/$case_name"

[[ -f $case_dir/request.txt ]] || { echo "unknown case: $case_name" >&2; exit 2; }
[[ ! -e $workspace ]] || { echo "workspace exists: $workspace" >&2; exit 2; }

mkdir -p "$workspace/repo" "$workspace/_shared/scripts" "$workspace/wayne-home"
cp -R "$harness/cases/_repo/." "$workspace/repo/"
cp "$repo_root/_shared/task-prompt.md" "$workspace/_shared/"
cp "$repo_root/_shared/scripts/wayne-state-dir.sh" "$workspace/_shared/scripts/"
# Seeded Wayne state lives beside repo/, under WAYNE_HOME, never inside the repository.
if [[ -d $case_dir/wayne-home ]]; then
    cp -R "$case_dir/wayne-home/." "$workspace/wayne-home/"
fi

case $arm in
    control)
        cp "$harness/skills-catalog.md" "$workspace/skills-catalog.md"
        intro="The Wayne skills installed on this machine are listed in \`/workspace/skills-catalog.md\`. The shared task prompt contract is \`/workspace/_shared/task-prompt.md\`."
        ;;
    candidate)
        mkdir -p "$workspace/wayne-go"
        cp -R "$repo_root/wayne-go/." "$workspace/wayne-go/"
        intro="Read \`/workspace/wayne-go/SKILL.md\` completely and follow it as the supplied Wayne skill. Read only the direct resources it routes this request to."
        ;;
    *)
        echo "unknown arm: $arm" >&2
        exit 2
        ;;
esac

{
    echo "$intro"
    echo
    echo "The repository is \`/workspace/repo\`. Wayne state lives under \`\$WAYNE_HOME\` (\`/workspace/wayne-home\`)."
    echo
    echo "User request:"
    echo
    sed 's/^/> /' "$case_dir/request.txt"
} > "$workspace/task.md"

git -C "$workspace/repo" init -q
git -C "$workspace/repo" config user.name "Eval Fixture"
git -C "$workspace/repo" config user.email "eval@example.invalid"
git -C "$workspace/repo" add .
git -C "$workspace/repo" commit -q -m "fixture: base"
git -C "$workspace/repo" branch -M main
if [[ -x $case_dir/setup.sh ]]; then
    (cd "$workspace/repo" && "$case_dir/setup.sh")
fi
git -C "$workspace/repo" diff > "$workspace/before.diff"
(cd "$workspace" && find . -path ./repo/.git -prune -o -type f -print | sort) > "$workspace/before.files"
