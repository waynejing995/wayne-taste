#!/usr/bin/env bash
# Harness identity, for every reader: the git tree object of this directory at
# HEAD. Git already content-addresses the tree, so nothing has to be recomputed
# by hand and the id changes only when the harness itself changes.
#
# Fails loud on an uncommitted harness: a recorded id must describe exactly the
# harness that ran, so commit the harness before preparing a trial. Calibration
# has to run before that commit exists, so it sets HARNESS_ID_ALLOW_DIRTY=1 and
# gets a `dirty:` id that can never be mistaken for a scored one.
set -euo pipefail

harness=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
prefix=$(git -C "$harness" rev-parse --show-prefix)
prefix=${prefix%/}
tree=$(git -C "$harness" rev-parse "HEAD:$prefix")

dirty=$(git -C "$harness" status --porcelain -- "$harness")
if [[ -z $dirty ]]; then
    printf '%s\n' "$tree"
    exit 0
fi
if [[ ${HARNESS_ID_ALLOW_DIRTY:-0} == 1 ]]; then
    printf 'dirty:%s\n' "$tree"
    exit 0
fi
echo "harness has uncommitted changes; commit $prefix before running a trial:" >&2
echo "$dirty" >&2
exit 1
