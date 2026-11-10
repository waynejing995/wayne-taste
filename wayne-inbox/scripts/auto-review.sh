# Sourced by watch-prs.sh and pr-ready.sh: how to read a TRACE multi-source auto-review.
# AUTO is the phrase that marks one (a review or PR comment body). AUTO_JQ, run with `--arg auto "$AUTO"` on an
# item with a .body, prints its fields as `key=value` lines. verdict: clean = the body says "no critical issue" and
# has no line starting with a CRITICAL heading or item; a "CRITICAL candidates downgraded" heading lists non-critical
# items. commit: the reviewed sha, first of `@ sha`, `head sha`, the end of a `base..sha` range, `of|at sha`,
# searched from the phrase on; cut to 9 characters.
AUTO='Multi-source auto-review'
AUTO_JQ='
  (.body | split($auto)[1:] | join($auto))[0:600] as $s
  | "verdict=" + (if (.body | test("no critical issue"; "i")) and (.body | test("(^|\n)[#*>\\s-]*CRITICAL\\b(?! candidates)") | not)
                  then "clean" else "critical" end),
    ([$s | capture("@\\s*`?(?<c>[0-9a-f]{7,40})\\b"),
           capture("\\bhead\\s+`?(?<c>[0-9a-f]{7,40})\\b"; "i"),
           capture("[0-9a-f]{7,40}\\.{2,3}`?(?<c>[0-9a-f]{7,40})\\b"),
           capture("\\b(?:of|at)\\s+`?(?<c>[0-9a-f]{7,40})\\b")] | first | select(.) | "commit=" + .c[0:9])'
