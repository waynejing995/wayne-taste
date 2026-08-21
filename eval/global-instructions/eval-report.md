# Eval report: razor design/review clauses

Candidate under test: four clauses added to `CLAUDE.md` under Novacula Occami
(Design / Review / Over-defense / Floor) plus a scope sentence in Fail Loud.
Control: `CLAUDE.md` at the baseline pinned by `control.ref`.
Models: Claude `opus/high`, Codex `dvue-aoai-001-gpt-5.6-sol/high`. One trial per cell.

## Round 1 — coding cases

`overbuild-trap`, `defense-floor`, `review-restraint`, both lanes, control and candidate.

| Result | Count |
| --- | --- |
| PASS | 14 / 14 |

No target flipped, because control passed every case. The cases sit below the
threshold at which the baseline instructions already fail, so the round proves no
regression and nothing else. Two harness defects surfaced and were fixed: bytecode
caches were scored as agent diff, and the dirty-harness gate blocked calibration.

## Round 2 — design case

`design-overbuild`, a scale-bounded GPU test-farm brief. Deterministic layer
reported `SCORABLE` for all four trials. Quality came from `semantic-rubric.md`,
frozen and committed before the run, applied by four independent judges that each
saw one anonymised document, the rubric, and the brief.

| Document | Identity | Verdict | Surplus | Contradicted | Entities |
| --- | --- | --- | --- | --- | --- |
| D | control-claude | pass | 1 | 0 | 30 |
| A | control-codex | pass | 2 | 0 | 33 |
| C | candidate-codex | fail | 3 | 0 | 27 |
| B | candidate-claude | fail | 4 | 0 | 27 |

The candidate lost on both lanes. Every design covered R1-R8 and none weakened a
load-bearing requirement, so the split is entirely about unbought machinery.

## What the judges called surplus

- All four: an append-only audit/event-history table no requirement asks for.
- candidate-claude only: a read-only web view beside the CLI, a stored
  `nodes.boot_epoch` no mechanism reads, and an SSE streaming channel.
- candidate-codex only: an SSE push channel, and an operator-role split for
  clearing quarantine that R8 does not ask for.

## Judge reliability

The codex pair is not trustworthy at this threshold. `control-codex` proposes the
same Server-Sent Events push with a reconnect snapshot as `candidate-codex`, and
its judge classed that mechanism `earned` while the candidate's judge classed it
`surplus`. One inconsistent call moves a document across the rubric's `surplus >= 3`
line, which is exactly where these two documents sit.

The claude pair does not have that defect: `control-claude` proposes no streaming
channel and no second UI at all, so its lower surplus count reflects the document.

## Reading

Round 2 does not show the candidate helping, and the claude lane suggests it hurts.
The mechanism is a known one: the clauses enumerate the constructs they forbid
(abstraction, layer, config option, extension point, fallback, guard, branch), and
naming a construct raises its salience rather than suppressing it. The effect is
strongest exactly where the model's prior is strongest.

This is one trial per cell with a judge shown to be inconsistent on one pair. It is
not proof that the clauses are harmful. It is sufficient reason not to keep them in
their current wording on the strength of an unproven benefit.

## Earned harness follow-ups

- Judge inconsistency is measurable and was measured; repeat judging of the same
  document, or a paired judge that sees two anonymised documents at once, is now
  bought by observed data.
- A rubric threshold that a single inconsistent call can flip needs either graded
  reporting only, or agreement across repeated judgements before a verdict.
