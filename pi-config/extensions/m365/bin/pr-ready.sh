#!/usr/bin/env bash
# One-shot merge readiness of a PR: prints the four merge gates, then READY or NOT READY: <first blocking gate>.
#   review-head  the latest TRACE auto-review (review or PR comment, see auto-review.sh) names the current head sha
#   review-clean that review's verdict is clean
#   ci           at least one check on the head, every one completed with success, skipped or neutral
#                (status contexts: success)
#   mergeable    GitHub reports MERGEABLE
# Each gate line is `<gate> ok|FAIL|pending <evidence>`. Exit 0 only when READY; 1 when not; 2 on bad usage.
# Usage: pr-ready.sh <owner/repo> <pr>
set -euo pipefail

HERE="$(dirname "$(readlink -f "${BASH_SOURCE[0]}")")"
source "$HERE/auto-review.sh"

[ $# -eq 2 ] || { echo "usage: pr-ready.sh <owner/repo> <pr>" >&2; exit 2; }
repo=$1 pr=$2

data=$(gh pr view "$pr" -R "$repo" --json headRefOid,mergeable,reviews,comments,statusCheckRollup)
head=$(jq -r .headRefOid <<<"$data")
# Latest auto-review over reviews and PR comments, as {at, body}; null when there is none.
latest=$(jq -c --arg auto "$AUTO" '
  [(.reviews[]? | {at: .submittedAt, body}), (.comments[]? | {at: .createdAt, body})]
  | map(select(.body // "" | contains($auto))) | sort_by(.at) | last' <<<"$data")

gates=() # "<gate> <status> <evidence>"
if [ "$latest" = null ]; then
  gates+=("review-head pending no auto-review yet (head ${head:0:9})")
  gates+=("review-clean pending no auto-review yet")
else
  fields=$(jq -r --arg auto "$AUTO" "$AUTO_JQ" <<<"$latest")
  verdict=$(sed -n 's/^verdict=//p' <<<"$fields")
  commit=$(sed -n 's/^commit=//p' <<<"$fields")
  at=$(jq -r .at <<<"$latest")
  if [ -z "$commit" ]; then
    gates+=("review-head FAIL auto-review at $at names no commit (head ${head:0:9})")
  elif [[ $head == "$commit"* ]]; then
    gates+=("review-head ok auto-review at $at @ $commit = head")
  else
    gates+=("review-head FAIL auto-review at $at @ $commit, head is ${head:0:9}")
  fi
  if [ "$verdict" = clean ]; then
    gates+=("review-clean ok verdict=clean (review @ ${commit:-?})")
  else
    gates+=("review-clean FAIL verdict=$verdict (review @ ${commit:-?})")
  fi
fi

# A check is ok, pending or failed; a failure blocks even while others still run. No check at all fails: a PR stacked
# on a branch other than main gets no CI, and an empty rollup must not read as green.
ci=$(jq -r '
  [.statusCheckRollup[]? | if .__typename == "CheckRun"
     then {name, s: (if .status != "COMPLETED" then "pending"
                     elif (.conclusion | IN("SUCCESS", "SKIPPED", "NEUTRAL")) then "ok" else "failed" end),
           why: (if .status != "COMPLETED" then .status else .conclusion end)}
     else {name: .context, s: (if .state == "SUCCESS" then "ok" elif (.state | IN("PENDING", "EXPECTED")) then "pending"
                                else "failed" end), why: .state} end] as $c
  | ($c | map(select(.s == "failed"))) as $f | ($c | map(select(.s == "pending"))) as $p
  | if ($c | length) == 0 then "FAIL no checks on head"
    elif ($f | length) > 0 then "FAIL \($f | length)/\($c | length) failed: " + ($f | map("\(.name) \(.why)") | join(", "))
    elif ($p | length) > 0 then "pending \($p | length)/\($c | length) not done: " + ($p | map("\(.name) \(.why)") | join(", "))
    else "ok \($c | length) checks passed" end' <<<"$data")
gates+=("ci $ci")

mergeable=$(jq -r .mergeable <<<"$data")
case $mergeable in
  MERGEABLE) gates+=("mergeable ok MERGEABLE") ;;
  UNKNOWN) gates+=("mergeable pending UNKNOWN (GitHub still computing)") ;;
  *) gates+=("mergeable FAIL $mergeable") ;;
esac

blocking=""
for g in "${gates[@]}"; do
  read -r name status evidence <<<"$g"
  printf '%-13s %-8s %s\n' "$name" "$status" "$evidence"
  [ -n "$blocking" ] || [ "$status" = ok ] || blocking=$name
done
if [ -z "$blocking" ]; then echo READY; else echo "NOT READY: $blocking"; exit 1; fi
