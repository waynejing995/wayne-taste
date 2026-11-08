#!/usr/bin/env bash
# Watch your open PRs and feed new reviews, failed checks and merges into the inbox.
# One event per native id (review id, check-run id, merge), so a later review or CI run on the same PR is new.
# Cursor: ~/.wayne/inbox/cursors/github-prs.since (ISO time of the last run); dedupe is by ledger key anyway.
# Usage: watch-prs.sh [repo ...]   (default: the repos under `github:` in ~/.wayne/inbox/rules.yaml)
set -euo pipefail

INBOX_DIR="${WAYNE_INBOX_DIR:-$HOME/.wayne/inbox}"
HERE="$(cd "$(dirname "$0")" && pwd)"
INBOX=(uv run --quiet "$HERE/inbox.py")
CURSOR="$INBOX_DIR/cursors/github-prs.since"
mkdir -p "$INBOX_DIR/cursors"

repos=("$@")
if [ ${#repos[@]} -eq 0 ]; then
  places=$("${INBOX[@]}" places github) # fails loudly when rules.yaml lists no github repo
  mapfile -t repos <<<"$places"
fi
since="$(cat "$CURSOR" 2>/dev/null || date -u -d '-1 day' +%Y-%m-%dT%H:%M:%SZ)"
now="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

emit() { # key subject note link field...  (place = the repo, global $repo)
  local key=$1 subject=$2 note=$3 link=$4; shift 4
  local args=(add --source github --place "$repo" --key "$key" --subject "$subject" --note "$note" --link "$link")
  for f in "$@"; do args+=(--field "$f"); done
  local result
  result=$("${INBOX[@]}" "${args[@]}") || return $? # a failed add must not let the cursor advance
  echo "$key -> $result"
}

for repo in "${repos[@]}"; do
  short="${repo##*/}"
  # Open or recently closed PRs by me that changed since the cursor.
  gh pr list -R "$repo" --author @me --state all --limit 50 \
    --search "updated:>=${since%%T*}" \
    --json number,title,url,state,mergedAt,reviews,statusCheckRollup |
  jq -c --arg since "$since" '.[]' | while read -r pr; do
    n=$(jq -r .number <<<"$pr"); title=$(jq -r .title <<<"$pr"); url=$(jq -r .url <<<"$pr")
    subj="$short#$n"
    jq -c --arg since "$since" '.reviews[] | select(.submittedAt >= $since)' <<<"$pr" | while read -r r; do
      emit "github:$repo#$n:review:$(jq -r .id <<<"$r")" "$subj" \
        "$(jq -r '.author.login + " " + .state' <<<"$r"): $title" "$url" \
        "number=$n" "event=review" "state=$(jq -r .state <<<"$r")" "actor=$(jq -r .author.login <<<"$r")"
    done
    jq -c '.statusCheckRollup[]? | select(.__typename=="CheckRun" and .status=="COMPLETED")' <<<"$pr" | while read -r c; do
      # One check run = one job; its id is the /job/<id> in detailsUrl (the run id is shared by every job).
      emit "github:$repo#$n:check:$(jq -r '(.detailsUrl | capture("/job/(?<id>[0-9]+)").id) // .name' <<<"$c")" "$subj" \
        "$(jq -r '.name + " " + .conclusion' <<<"$c"): $title" "$(jq -r .detailsUrl <<<"$c")" \
        "number=$n" "event=check" "state=$(jq -r .conclusion <<<"$c")"
    done
    if [ "$(jq -r .mergedAt <<<"$pr")" != "null" ]; then
      emit "github:$repo#$n:merged" "$subj" "merged: $title" "$url" "number=$n" "event=merged" "state=MERGED"
    fi
  done
done
echo "$now" >"$CURSOR"
