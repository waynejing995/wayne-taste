#!/usr/bin/env bash
set -euo pipefail

if [[ $# -ne 1 ]]; then
    echo "usage: $0 <output-file>" >&2
    exit 2
fi

root=$(git -C "$(dirname "$0")" rev-parse --show-toplevel)
ref="$root/eval/global-instructions/control.ref"
output=$(realpath -m "$1")

commit=$(sed -n 's/^commit=//p' "$ref")
path=$(sed -n 's/^path=//p' "$ref")
expected_blob=$(sed -n 's/^blob=//p' "$ref")
expected_sha=$(sed -n 's/^sha256=//p' "$ref")

[[ $(git -C "$root" rev-parse "$commit:$path") == "$expected_blob" ]] || {
    echo "control blob mismatch" >&2
    exit 1
}
mkdir -p "$(dirname "$output")"
git -C "$root" show "$commit:$path" > "$output"
[[ $(sha256sum "$output" | cut -d' ' -f1) == "$expected_sha" ]] || {
    echo "control sha256 mismatch" >&2
    exit 1
}
printf '%s\n' "$output"
