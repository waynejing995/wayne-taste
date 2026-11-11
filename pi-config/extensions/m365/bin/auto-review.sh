# Sourced by watch-prs.sh and pr-ready.sh: how to read a TRACE multi-source auto-review.
# AUTO is the phrase that marks one (a review or PR comment body). AUTO_JQ, run with `--arg auto "$AUTO"` on an
# item with a .body, prints its fields as `key=value` lines.
# verdict: clean = the body says "no critical", up to two words between ("No new CRITICAL issues", "No critical
# findings"), and no line
#   - is a CRITICAL heading or item: after markup, at most two words that are not no/not/as/earlier/prior/previous,
#     then CRITICAL ("### CRITICAL (1, posted inline)", "**New inline CRITICAL (2):**", "**3 new CRITICALs"); a
#     "CRITICAL candidate(s)" or "... CRITICAL, downgraded" heading lists non-critical items, or
#   - says findings persist, in a clause (split at line ends, `. `, `; ` and `, but`) whose subject is not "no ...":
#     "still|remain(s) [one word] open|present|unresolved|unaddressed|unchanged", "remaining critical", or a clause
#     naming critical with "is|are [one word]" before those ("6 prior CRITICALs are still present", "**Still open,
#     already posted inline", "Not approving while these remain open"). "are still fixed", "No remaining critical
#     issues" and "No critical issues remain open" are not.
# else critical.
# commit: the reviewed sha, first of `@ sha`, `head sha`, the end of a `base..sha` range, `of|at sha`,
# searched from the phrase on; cut to 9 characters.
AUTO='Multi-source auto-review'
AUTO_JQ='
  def says_none: test("\\bno\\s+(?:\\w+\\s+){0,2}critical\\b"; "i");
  def has_heading:
    test("(^|\n)[#*>\\s-]*(?:(?!(?i:no|not|as|earlier|prior|previous)\\b)\\w+\\s+){0,2}CRITICALs?\\b(?! candidates?|,? downgraded)");
  def persists: [splits("\n|[.;]\\s+|,?\\s+but\\s+"; "i")] | any(
    (test("^[#*>\\s-]*no\\b"; "i") | not) and (
      test("\\b(?:still|remains?)\\s+(?:\\w+\\s+)?(?:open|present|unresolved|unaddressed|unchanged)\\b|\\bremaining\\s+critical"; "i")
      or (test("critical"; "i") and test("\\b(?:is|are)\\s+(?:\\w+\\s+)?(?:open|present|unresolved|unaddressed|unchanged)\\b"; "i"))));
  (.body | split($auto)[1:] | join($auto))[0:600] as $s
  | "verdict=" + (if (.body | says_none) and (.body | has_heading | not) and (.body | persists | not)
                  then "clean" else "critical" end),
    ([$s | capture("@\\s*`?(?<c>[0-9a-f]{7,40})\\b"),
           capture("\\bhead\\s+`?(?<c>[0-9a-f]{7,40})\\b"; "i"),
           capture("[0-9a-f]{7,40}\\.{2,3}`?(?<c>[0-9a-f]{7,40})\\b"),
           capture("\\b(?:of|at)\\s+`?(?<c>[0-9a-f]{7,40})\\b")] | first | select(.) | "commit=" + .c[0:9])'
