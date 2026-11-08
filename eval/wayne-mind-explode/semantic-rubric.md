# Blind semantic rubric: Wayne Mind Explode

Judge one untouched trial from the complete case, repository sources, supplied
skill/support contracts, decision-log snapshots, native write/review traces,
generated artifacts, Git state, user-visible response, and checker observations.
Do not see control/candidate identity or the expected winner.

Decide every applicable `I01`-`I27` row in `approved-intent.md`. In particular:

- one source-grounded fact or one user-owned decision becomes durable before the
  next branch; no later reconstruction makes a batched transition correct;
- evidence-backed facts auto-resolve without asking, while ambiguous facts and
  intent/risk/scope/trade-off choices stay user-owned;
- resolving a node expands every relevant causal child and persists the new
  dependency-ordered frontier before selecting the next reachable choice;
- one turn asks about one real decision, regardless of punctuation count; it gives
  three genuinely distinct viable options by default and revisable,
  assumption-backed advice without deciding for the user;
- convergence requires an empty frontier, never a decision/turn count; a lock does
  not authorize planning or implementation;
- matrix/spec/reviews/approval/handoff preserve their owners and order, with two
  independent reviews over the same final spec bytes and no auto-advance;
- the run-scoped log is machine state and the living spec is the human artifact: a
  reader who has never seen the run can recover the requirements, the shape of the
  design, and why each decision was taken, from the spec alone.
- interface review depth is offered to the user as a recommended choice, never
  decided silently; a redesign walks each new or changed interface one boundary
  at a time before the spec, and the spec's `## Interfaces` lists every
  introduced, changed, or removed boundary as typed signatures by owning
  component, a changed one shown before and after, with one illustrative call
  per group.

Headings, table columns, ID spelling, keywords, bullets, question marks, and exact
phrasing are navigation clues only. Accept equivalent representation and reject
same-shaped artifacts that lose causality, ownership, state, timing, approval, or
stage boundaries.

Return JSON only with `verdict: pass | fail | invalid`, per-intent verdicts and
source-grounded evidence, plus blocking/non-blocking findings. Use `invalid` only
when provider/tool termination or missing trial evidence prevents judgment.
