#!/usr/bin/env bash
set -euo pipefail

if [[ $# -ne 3 ]]; then
    echo "usage: $0 <author-workspace> <claude|codex> <review-workspace>" >&2
    exit 2
fi

author=$(realpath "$1")
provider=$2
workspace=$(realpath -m "$3")
harness=$(cd "$(dirname "$0")" && pwd)
dossier="$author/repo/eval/decision-builder"

[[ "$provider" == "claude" || "$provider" == "codex" ]] || {
    echo "invalid provider: $provider" >&2
    exit 2
}
[[ -f "$dossier/intent-ledger.json" ]] || { echo "missing author dossier" >&2; exit 2; }
[[ ! -e "$dossier/semantic-reviews" ]] || {
    echo "author workspace already contains semantic reviews" >&2
    exit 2
}
[[ ! -e "$workspace" ]] || { echo "review workspace already exists: $workspace" >&2; exit 2; }

mkdir -p "$workspace"
cp -a "$author/repo" "$workspace/repo"
cp "$harness/review-task.md" "$workspace/task.md"

ledger="$workspace/repo/eval/decision-builder/intent-ledger.json"
manifest="$workspace/repo/eval/decision-builder/oracle-manifest.json"
source_json=$(jq -c '[.sources[] | {id, sha256}] | sort_by(.id)' "$ledger")
source_sha=$(printf '%s' "$source_json" | sha256sum | cut -d' ' -f1)
ledger_sha=$(sha256sum "$ledger" | cut -d' ' -f1)

jq -n \
  --arg provider "$provider" \
  --arg source_sha256 "$source_sha" \
  --arg ledger_sha256 "$ledger_sha" \
  --argjson reviewed_source_ids "$(jq -c '[.sources[].id]' "$ledger")" \
  --argjson reviewed_behavior_ids "$(jq -c '[.behaviors[].id]' "$ledger")" \
  --argjson reviewed_oracle_ids "$(jq -c '[.oracles[].id]' "$manifest")" \
  '{version:1, provider:$provider, source_sha256:$source_sha256,
    ledger_sha256:$ledger_sha256, reviewed_source_ids:$reviewed_source_ids,
    reviewed_behavior_ids:$reviewed_behavior_ids,
    reviewed_oracle_ids:$reviewed_oracle_ids}' > "$workspace/review-context.json"

find "$workspace/repo/eval/decision-builder" -type f -print0 \
  | sort -z | xargs -0 sha256sum \
  > "$workspace/dossier-manifest.sha256"
git -C "$workspace/repo" rev-parse HEAD > "$workspace/repo-head.txt"
git -C "$workspace/repo" status --porcelain=v1 --untracked-files=all \
  > "$workspace/repo-status.txt"
git -C "$workspace/repo" diff --binary --full-index HEAD -- \
  | sha256sum | cut -d' ' -f1 > "$workspace/repo-diff.sha256"
