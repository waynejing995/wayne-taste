# Approved intent: Wayne Triage

`wayne-triage` is a read-only front door that turns a failure or tracker item into
evidence-backed attribution and one next route. It never becomes the fixer,
tracker-state owner, or knowledge writer.

## Shared spine

1. Select `failure` or `tracker` from observable input. A tracker item with an
   attached failure artifact runs tracker intake and every matching symptom path.
2. If data is absent and no fetch method was supplied, ask exactly one question
   for where/how to obtain it. Do not guess a source or call a network API.
3. Write one `.wayne/triage/<date>-<slug>.md` evidence SSoT once evidence exists.
4. Reproduce or explicitly mark non-determinism. Keep symptom and cause as separate
   axes; set signals, estimated fix size, and blast radius from evidence.
5. Select all matching playbooks. If none match, set cause `unknown`, route
   `needs-info`, ask for the smallest missing observable, and do not invent a cause.
6. Use one falsifiable hypothesis per matrix column and eliminate with one-variable,
   read-only checks. Trace the bad value backward to its source.
7. Compare symptom layer with cause layer. If they disagree and evidence cannot
   decide, preserve both and route `uncertain`.
8. Select the route only from a checkable landing field and name that field in
   `route.justified_by`. A bug cannot route toward a fix without a failing repro.
9. Present the route for human approval. Only after approval, hand the evidence
   snapshot to `wayne-checkpoint`; never auto-run the next stage.

## Surfaces and route contract

| Situation | Required result |
|---|---|
| internal single-file certain fix, at most 10 lines, failing repro exists | `fix-now` |
| small certain bug without failing test | `test-then-fix` |
| internal fix at most 100 lines with pass/fail eval | `iterate-in-a-loop` |
| more than 100 lines or shared interface/contract/config | `needs-plan` |
| at least three failed fixes or cascading breakage | `escalate-architecture` |
| customer-visible, cross-team, or unsolved about one hour | `escalate-incident` |
| confirmed cause belongs to another owner | `route-to-owner` |
| symptom/cause attribution conflict remains | `uncertain` |
| missing data, failed repro, or no matching signal | `needs-info` |

Tracker intake recommends exactly one category and state but never changes labels,
assignee, state, or status. A fully specified enhancement does not need a bug repro;
it gets acceptance criteria and normally routes to `needs-plan`.

Large-log and multi-boundary investigation may use independent evidence gatherers,
but only the main agent owns attribution and route selection. Product code, tracker
state, KB, commits, branches, pushes, and publishing are outside triage.
