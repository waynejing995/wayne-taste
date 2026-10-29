#!/usr/bin/env bash
# Print, creating it if needed, the Wayne state directory of the project that
# contains <dir> (default: the current directory).
#
#   ${WAYNE_HOME:-~/.wayne}/projects/<key>
#
# <key> names the real project, not the checkout: every clone and every
# worktree of one repository resolves to the same directory.
#   - remote `origin` set  -> its repository path, e.g. AMD-GPU-Virtual/TRACE
#   - no `origin`          -> the main worktree's directory name
#
# Contract: _shared/pipeline-id-contract.md § Project state directory.
# Usage: bash wayne-state-dir.sh [dir]
set -euo pipefail

die() { echo "wayne-state-dir: $*" >&2; exit 1; }

dir=${1:-.}
common=$(git -C "$dir" rev-parse --path-format=absolute --git-common-dir 2>/dev/null) \
    || die "not inside a git repository: $dir"

url=$(git -C "$dir" config --get remote.origin.url || true)
if [[ -n $url ]]; then
    key=${url%/}
    key=${key%.git}
    case $key in
        *://*) key=${key#*://}; key=${key#*/} ;; # scheme://[user@]host[:port]/path
        /*) key=$(basename "$key") ;;            # local path remote
        *:*) key=${key#*:} ;;                    # scp-like [user@]host:path
        *) key=$(basename "$key") ;;
    esac
else
    # The common dir of a non-bare repository is <main worktree>/.git.
    key=$(basename "$(dirname "$common")")
fi

[[ $key =~ ^[A-Za-z0-9._-]+(/[A-Za-z0-9._-]+)*$ ]] || die "cannot derive a project key from '${url:-$common}' (got '$key')"
[[ /$key/ != */../* && /$key/ != */./* ]] || die "project key has a dot segment: $key"

state="${WAYNE_HOME:-$HOME/.wayne}/projects/$key"
mkdir -p "$state"
printf '%s\n' "$state"
