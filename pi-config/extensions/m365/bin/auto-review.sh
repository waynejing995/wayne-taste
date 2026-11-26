# Sourced by watch-prs.sh and pr-ready.sh: how to read a TRACE multi-source auto-review.
# AUTO is the phrase that marks one (a review or PR comment body). AUTO_JQ, run with `--arg auto "$AUTO"` on an
# item with a .body, prints its fields as `key=value` lines.
# verdict: clean = the body says "no critical", up to two words between ("No new CRITICAL issues", "No critical
# findings"), or has an explicitly empty CRITICAL section, and no line
#   - is a CRITICAL heading or item: after markup, at most two words that are not no/not/as/earlier/prior/previous,
#     then CRITICAL ("### CRITICAL (1, posted inline)", "**New inline CRITICAL (2):**", "**3 new CRITICALs"); a
#     "CRITICAL candidate(s)" or "... CRITICAL, downgraded" heading lists non-critical items. A ### CRITICAL section
#     whose entire non-empty body is "None" or "None." also has no findings, or
#   - says findings persist outside ### CRITICAL candidates downgraded and ### Informational sections, in a clause
#     (split at line ends, `. `, `; ` and `, but`) whose subject is not "no ...":
#     "still|remain(s) [one word] open|present|unresolved|unaddressed|unchanged", "remaining critical", or a clause
#     naming critical with "is|are [one word]" before those ("6 prior CRITICALs are still present", "**Still open,
#     already posted inline", "Not approving while these remain open"). "are still fixed", "No remaining critical
#     issues" and "No critical issues remain open" are not.
# else critical.
# commit: the reviewed sha, first of `Reviewed commit: sha`, `@ sha`, `head sha`, the end of a `base..sha`,
# `ref...sha` or `merge-base(...)...sha` range, `of|at sha` (each sha full or short, backticked or not), searched from
# the phrase on; cut to 9 characters. The caller compares it to the head by prefix.
AUTO='Multi-source auto-review'
AUTO_JQ='
  def says_none: test("\\bno\\s+(?:\\w+\\s+){0,2}critical\\b"; "i");
  def without_empty_critical_sections:
    gsub("(?m)^[ \\t]{0,3}###\\s+CRITICAL[ \\t]*\\r?\\n[ \\t\\r\\n]*None\\.?[ \\t\\r\\n]*(?=^[ \\t]{0,3}#{1,3}[ \\t]+|\\z)"; ""; "i");
  def without_noncritical_sections:
    gsub("(?m)^[ \\t]{0,3}###[ \\t]+(?:CRITICAL[ \\t]+candidates?[ \\t]+downgraded|INFORMATIONAL)\\b[^\\n]*\\n(?:[\\s\\S]*?)(?=^[ \\t]{0,3}#{1,3}[ \\t]+|\\z)"; ""; "i");
  def has_heading:
    without_empty_critical_sections | test("(^|\n)[#*>\\s-]*(?:(?!(?i:no|not|as|earlier|prior|previous)\\b)\\w+\\s+){0,2}CRITICALs?\\b(?! candidates?|,? downgraded)");
  def persists: without_noncritical_sections | [splits("\n|[.;]\\s+|,?\\s+but\\s+"; "i")] | any(
    (test("^[#*>\\s-]*no\\b"; "i") | not) and (
      test("\\b(?:still|remains?)\\s+(?:\\w+\\s+)?(?:open|present|unresolved|unaddressed|unchanged)\\b|\\bremaining\\s+critical"; "i")
      or (test("critical"; "i") and test("\\b(?:is|are)\\s+(?:\\w+\\s+)?(?:open|present|unresolved|unaddressed|unchanged)\\b"; "i"))));
  (.body | split($auto)[1:] | join($auto))[0:600] as $s
  | "verdict=" + (if ((.body | says_none) or (.body != (.body | without_empty_critical_sections))) and (.body | has_heading | not) and (.body | persists | not)
                  then "clean" else "critical" end),
    ([$s | capture("\\breviewed\\s+commit:?\\s*`?(?<c>[0-9a-f]{7,40})\\b"; "i"),
           capture("@\\s*`?(?<c>[0-9a-f]{7,40})\\b"),
           capture("\\bhead\\s+`?(?<c>[0-9a-f]{7,40})\\b"; "i"),
           capture("(?:[0-9a-f]{7,40}|\\)|[A-Za-z][\\w./-]*)\\.{2,3}`?(?<c>[0-9a-f]{7,40})\\b"),
           capture("\\b(?:of|at)\\s+`?(?<c>[0-9a-f]{7,40})\\b")] | first | select(.) | "commit=" + .c[0:9])'
