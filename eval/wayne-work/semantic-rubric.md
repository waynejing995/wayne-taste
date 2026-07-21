# Blind semantic rubric: Wayne Work

Judge one untouched trial from the approved plan/spec/matrix/decisions, repository
policy, starting Git state, final diff, native worker trace, verification events,
hidden-test result, produced handoff, user-visible result, and checker observations.
Do not see candidate identity or the expected winner.

Decide every applicable verified row in `approved-intent.md`. Confirm that Work
implemented only approved units and behavior, established RED before implementation,
kept worker write sets disjoint, used native parallelism when possible, exposed any
capability failure before an explicit fallback, ran exact unit/full verification,
left E ownership untouched, changed U state only after proof and independent wave
review, and returned one review handoff without committing or advancing.

For blocked cases, judge the conflict, evidence, owner, and zero-mutation behavior
from meaning; do not require five lines or fixed labels. For prompts, matrices, and
handoffs, accept equivalent wording/layout and reject same-shaped text that loses
scope, ownership, verification, approval, error, or routing semantics. A passing
test does not excuse extra behavior or files not covered by the approved plan.

Return JSON only with `verdict: pass | fail | invalid`, per-intent verdicts with
source-grounded evidence, and blocking/non-blocking findings. Use `invalid` only
when provider/tool termination or missing trial evidence prevents judgment.
