#!/usr/bin/env bash
# One-shot merge readiness of a PR (GitHub native Stacked PR aware): prints the merge gates for every unmerged PR
# that merging `<pr>` would land into the default branch, then READY or NOT READY: <first blocking gate>.
#   stack-base   when stacked/non-default base: verifies native GitHub stack membership (GraphQL PullRequest.stack)
#                targeting the repo's default branch with no closed/missing lower PRs
#   review-head  the latest TRACE auto-review (review or PR comment, see auto-review.sh) names the current head sha
#   review-clean that review's verdict is clean
#   ci           at least one check on the head, every one completed with success, skipped or neutral
#                (status contexts: success)
#   mergeable    GitHub reports MERGEABLE
# Each gate line is `<gate> ok|FAIL|pending <evidence>` (prefixed with `[#<pr>] ` for multi-PR native stacks).
# Exit 0 only when READY (entire contiguous native stack passes every gate); 1 when not; 2 on bad usage.
# Usage: pr-ready.sh <owner/repo> <pr>
set -euo pipefail

HERE="$(dirname "$(readlink -f "${BASH_SOURCE[0]}")")"
source "$HERE/auto-review.sh"

[ $# -eq 2 ] || { echo "usage: pr-ready.sh <owner/repo> <pr>" >&2; exit 2; }
repo=$1 target_pr=$2
owner=${repo%%/*}
name=${repo#*/}

stack_meta=$(gh api graphql \
  -f owner="$owner" -f name="$name" -F number="$target_pr" \
  -f query='query($owner: String!, $name: String!, $number: Int!) {
    repository(owner: $owner, name: $name) {
      defaultBranchRef { name }
      pullRequest(number: $number) {
        number
        state
        baseRefName
        stackEntry { position }
        stack {
          number
          baseRefName
          entries(first: 100) {
            nodes {
              position
              pullRequest { number state }
            }
          }
        }
      }
    }
  }')

default_branch=$(jq -r '.data.repository.defaultBranchRef.name' <<<"$stack_meta")
target_state=$(jq -r '.data.repository.pullRequest.state' <<<"$stack_meta")
target_base=$(jq -r '.data.repository.pullRequest.baseRefName' <<<"$stack_meta")
has_stack=$(jq -r '.data.repository.pullRequest.stack != null' <<<"$stack_meta")

stack=()
stack_base_gate=""
stack_number=""

if [ "$target_state" != "OPEN" ]; then
  stack_base_gate="stack-base FAIL PR #$target_pr state is $target_state"
  stack=("$target_pr")
elif [ "$has_stack" = "true" ]; then
  stack_number=$(jq -r '.data.repository.pullRequest.stack.number' <<<"$stack_meta")
  stack_target=$(jq -r '.data.repository.pullRequest.stack.baseRefName' <<<"$stack_meta")
  target_pos=$(jq -r '.data.repository.pullRequest.stackEntry.position // empty' <<<"$stack_meta")
  if [ -z "$target_pos" ]; then
    stack_base_gate="stack-base FAIL PR #$target_pr has stack #$stack_number without stackEntry.position"
    stack=("$target_pr")
  elif [ "$stack_target" != "$default_branch" ]; then
    stack_base_gate="stack-base FAIL native stack #$stack_number targets '$stack_target' (not default branch '$default_branch')"
    stack=("$target_pr")
  else
    bad_lower=$(jq -r --argjson pos "$target_pos" '
      [.data.repository.pullRequest.stack.entries.nodes[]
       | select(.position <= $pos)
       | select(.pullRequest == null or (.pullRequest.state | IN("OPEN", "MERGED") | not))
       | if .pullRequest == null then "pos \(.position) missing PR"
         else "#\(.pullRequest.number) is \(.pullRequest.state)" end] | join(", ")' <<<"$stack_meta")
    if [ -n "$bad_lower" ]; then
      stack_base_gate="stack-base FAIL native stack #$stack_number has non-mergeable lower entry: $bad_lower"
    fi
    mapfile -t stack < <(jq -r --argjson pos "$target_pos" '
      [.data.repository.pullRequest.stack.entries.nodes[]
       | select(.position <= $pos and .pullRequest != null and .pullRequest.state == "OPEN")]
      | sort_by(.position) | .[].pullRequest.number' <<<"$stack_meta")
    [ "${#stack[@]}" -gt 0 ] || stack=("$target_pr")
  fi
elif [ "$target_base" != "$default_branch" ]; then
  stack_base_gate="stack-base FAIL PR #$target_pr targets '$target_base' (not '$default_branch') and is not in a registered GitHub stack (use 'gh stack link' or retarget after parent merges)"
  stack=("$target_pr")
else
  stack=("$target_pr")
fi

declare -A pr_json=()
for pr in "${stack[@]}"; do
  pr_json[$pr]=$(gh pr view "$pr" -R "$repo" --json headRefOid,mergeable,reviews,comments,statusCheckRollup)
done

is_stack=0
[ "${#stack[@]}" -gt 1 ] && is_stack=1

blocking=""
print_gate() {
  local prefix=$1 name=$2 status=$3 evidence=$4
  if [ -n "$prefix" ]; then
    printf '%-8s %-13s %-8s %s\n' "$prefix" "$name" "$status" "$evidence"
  else
    printf '%-13s %-8s %s\n' "$name" "$status" "$evidence"
  fi
  if [ -z "$blocking" ] && [ "$status" != "ok" ]; then
    blocking="${prefix:+$prefix:}$name"
  fi
}

if [ -n "$stack_base_gate" ]; then
  read -r name status evidence <<<"$stack_base_gate"
  print_gate "" "$name" "$status" "$evidence"
elif [ "$is_stack" -eq 1 ]; then
  chain=$(printf '#%s -> ' "${stack[@]}")
  print_gate "" "stack-base" "ok" "native stack #$stack_number (${chain% -> }) targeting $default_branch"
fi
for pr in "${stack[@]}"; do
  data=${pr_json[$pr]}
  head=$(jq -r .headRefOid <<<"$data")
  prefix=""
  [ "$is_stack" -eq 1 ] && prefix="[#$pr]"

  latest=$(jq -c --arg auto "$AUTO" '
    [(.reviews[]? | {at: .submittedAt, body, oid: (.commit.oid // "")}), (.comments[]? | {at: .createdAt, body, oid: ""})]
    | map(select(.body // "" | contains($auto))) | sort_by(.at) | last' <<<"$data")

  if [ "$latest" = null ]; then
    print_gate "$prefix" "review-head" "pending" "no auto-review yet (head ${head:0:9})"
    print_gate "$prefix" "review-clean" "pending" "no auto-review yet"
  else
    fields=$(jq -r --arg auto "$AUTO" "$AUTO_JQ" <<<"$latest")
    verdict=$(sed -n 's/^verdict=//p' <<<"$fields")
    commit=$(sed -n 's/^commit=//p' <<<"$fields")
    [ -n "$commit" ] || commit=$(jq -r '.oid[0:9]' <<<"$latest")
    at=$(jq -r .at <<<"$latest")
    if [ -z "$commit" ]; then
      print_gate "$prefix" "review-head" "FAIL" "auto-review at $at names no commit (head ${head:0:9})"
    elif [[ $head == "$commit"* ]]; then
      print_gate "$prefix" "review-head" "ok" "auto-review at $at @ $commit = head"
    else
      print_gate "$prefix" "review-head" "FAIL" "auto-review at $at @ $commit, head is ${head:0:9}"
    fi
    if [ "$verdict" = clean ]; then
      print_gate "$prefix" "review-clean" "ok" "verdict=clean (review @ ${commit:-?})"
    else
      print_gate "$prefix" "review-clean" "FAIL" "verdict=$verdict (review @ ${commit:-?})"
    fi
  fi

  # A check is ok, pending or failed; a failure blocks even while others still run. No check at all fails:
  # an empty rollup must not read as green.
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
  read -r ci_status ci_evidence <<<"$ci"
  print_gate "$prefix" "ci" "$ci_status" "$ci_evidence"

  mergeable=$(jq -r .mergeable <<<"$data")
  case $mergeable in
    MERGEABLE) print_gate "$prefix" "mergeable" "ok" "MERGEABLE" ;;
    UNKNOWN) print_gate "$prefix" "mergeable" "pending" "UNKNOWN (GitHub still computing)" ;;
    *) print_gate "$prefix" "mergeable" "FAIL" "$mergeable" ;;
  esac
done

if [ -z "$blocking" ]; then echo READY; else echo "NOT READY: $blocking"; exit 1; fi
