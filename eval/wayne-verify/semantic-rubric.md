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

Do not judge meaning through keywords, negation patterns, or fixed phrasing. The
deterministic gate separately owns the exact machine verdict, row Status values,
commands, artifacts, mutation boundary, and event order. Semantically equivalent
prose passes; the same verdict line with an unsupported or wrong route fails.
