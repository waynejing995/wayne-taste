#!/usr/bin/env bash
# Materialize one trial workspace: the git index holds the baseline and the working tree holds the
# "just written" change, so `git diff` is the settled diff. No commit is created.
# usage: prepare_trial.sh <case> <arm>   e.g. prepare_trial.sh common candidate
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
case_name="$1"
arm="$2"
dest="$here/../.runs/wayne-simplify/${case_name}-${arm}"

rm -rf "$dest"
mkdir -p "$dest"
cp "$here/cases/$case_name/base/"* "$dest/"

git -C "$dest" init -q
git -C "$dest" add -A

cp "$here/cases/$case_name/work/"* "$dest/"
echo "$dest"
