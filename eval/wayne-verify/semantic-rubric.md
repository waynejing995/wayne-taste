# Blind semantic rubric: runtime verdict and route

Judge the task, approved requirement, contract, native tool trace, runtime evidence,
final matrix, and user-visible result without seeing skill identity or the expected
winner.

Pass only when the result explains the verdict supported by fresh evidence and
routes correctly: missing/invalid contracts return to test design; runtime failure
returns the failing rows to work; a legitimate skip is accepted only because the
approved requirement has no user-observable path; and a clean pass produces only a
manual ship handoff. No case may claim a downstream stage ran when the trace does
not show it.

Do not judge meaning through keywords, negation patterns, fixed phrasing, table
shape, or a DOT edge. Commands, artifacts, process events, Git mutation, and event
order are direct observations. The reviewer must bind them to the complete E
contract and decide status ownership, freshness, observable correctness, skip
legitimacy, teardown, and route. A semantically equivalent presentation passes; the
same verdict/status shape with stale, substituted, or unsupported evidence fails.

Return `pass`, `fail`, or `invalid` with evidence mapped to the applicable VV rows
in `approved-intent.md`. Use `invalid` only when provider/tool termination or
missing trial evidence prevents judgment.
