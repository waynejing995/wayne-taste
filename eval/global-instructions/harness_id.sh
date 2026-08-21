#!/usr/bin/env bash
# Harness identity, for every reader: the git tree object of this directory at
# HEAD. Git already content-addresses the tree, so nothing has to be recomputed
# by hand and the id changes only when the harness itself changes.
#
# Fails loud on an uncommitted harness: a recorded id must describe exactly the
# harness that ran, so commit the harness before preparing a trial.
set -euo pipefail

harness=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
prefix=$(git -C "$harness" rev-parse --show-prefix)
prefix=${prefix%/}

dirty=$(git -C "$harness" status --porcelain -- "$harness")
if [[ -n $dirty ]]; then
    echo "harness has uncommitted changes; commit $prefix before running a trial:" >&2
    echo "$dirty" >&2
    exit 1
fi

git -C "$harness" rev-parse "HEAD:$prefix"
