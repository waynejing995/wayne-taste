#!/usr/bin/env bash
# Watch your open PRs and feed new reviews, failed checks and merges into the inbox.
# One event per native id (review id, comment id, check-run id, merge), so a later review or CI run on the same PR is new.
# The TRACE multi-source auto-review posts from your own login, as a review or a PR comment whose body has
# "Multi-source auto-review". It is recorded as event=review actor=auto-review (so an `actor: <you>` ignore rule
# does not swallow it), with verdict=clean|critical and commit=<sha> when the body names one. Other PR comments are not read.
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

# Auto-review fields as `key=value` lines. verdict: clean = the body says "no critical issue" and has no line
# starting with a CRITICAL heading or item; a "CRITICAL candidates downgraded" heading lists non-critical items.
# commit: the reviewed sha, first of `@ sha`, `head sha`, the end of a `base..sha` range, `of|at sha`, searched
# from the phrase on; cut to 9 characters.
AUTO='Multi-source auto-review'
AUTO_JQ='
  (.body | split($auto)[1:] | join($auto))[0:600] as $s
  | "verdict=" + (if (.body | test("no critical issue"; "i")) and (.body | test("(^|\n)[#*>\\s-]*CRITICAL\\b(?! candidates)") | not)
                  then "clean" else "critical" end),
    ([$s | capture("@\\s*`?(?<c>[0-9a-f]{7,40})\\b"),
           capture("\\bhead\\s+`?(?<c>[0-9a-f]{7,40})\\b"; "i"),
           capture("[0-9a-f]{7,40}\\.{2,3}`?(?<c>[0-9a-f]{7,40})\\b"),
           capture("\\b(?:of|at)\\s+`?(?<c>[0-9a-f]{7,40})\\b")] | first | select(.) | "commit=" + .c[0:9])'

emit_auto() { # key kind(review|comment) link state item-json  (globals: repo, n, subj, title)
  local key=$1 kind=$2 link=$3 state=$4 item=$5 out fields
  out=$(jq -r --arg auto "$AUTO" "$AUTO_JQ" <<<"$item") || return $?
  mapfile -t fields <<<"$out"
  emit "$key" "$subj" "auto-review $kind ${fields[*]}: $title" "$link" \
    "number=$n" "event=review" "state=$state" "actor=auto-review" "${fields[@]}"
}

for repo in "${repos[@]}"; do
  short="${repo##*/}"
  # Open or recently closed PRs by me that changed since the cursor.
  gh pr list -R "$repo" --author @me --state all --limit 50 \
    --search "updated:>=${since%%T*}" \
    --json number,title,url,state,mergedAt,reviews,comments,statusCheckRollup |
  jq -c --arg since "$since" '.[]' | while read -r pr; do
    n=$(jq -r .number <<<"$pr"); title=$(jq -r .title <<<"$pr"); url=$(jq -r .url <<<"$pr")
    subj="$short#$n"
    jq -c --arg since "$since" '.reviews[] | select(.submittedAt >= $since)' <<<"$pr" | while read -r r; do
      key="github:$repo#$n:review:$(jq -r .id <<<"$r")"
      if jq -e --arg auto "$AUTO" '.body // "" | contains($auto)' <<<"$r" >/dev/null; then
        emit_auto "$key" review "$url" "$(jq -r .state <<<"$r")" "$r"
        continue
      fi
      emit "$key" "$subj" \
        "$(jq -r '.author.login + " " + .state' <<<"$r"): $title" "$url" \
        "number=$n" "event=review" "state=$(jq -r .state <<<"$r")" "actor=$(jq -r .author.login <<<"$r")"
    done
    jq -c --arg since "$since" --arg auto "$AUTO" \
      '.comments[]? | select(.createdAt >= $since and (.body // "" | contains($auto)))' <<<"$pr" | while read -r c; do
      emit_auto "github:$repo#$n:comment:$(jq -r .id <<<"$c")" comment "$(jq -r .url <<<"$c")" COMMENTED "$c"
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
