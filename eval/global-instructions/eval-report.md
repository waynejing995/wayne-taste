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

## Round 3 — pi lane, three trials per arm, provable delta

Rounds 1 and 2 copied the candidate from a live shared `CLAUDE.md`, so an unrelated
edit sat inside the measured delta. Round 3 builds the candidate as
`baseline + candidate-razor.patch`, verified to reproduce the exact bytes, and runs
one lane (pi, fresh `PI_CODING_AGENT_DIR`) three times per arm.

| Arm | Surplus per trial | Mean | Verdicts |
| --- | --- | --- | --- |
| control | 2, 2, 8 | 4.00 | 2 pass, 1 fail |
| candidate | 1, 2, 5 | 2.67 | 2 pass, 1 fail |

Every trial covered R1-R8 and none weakened a load-bearing requirement.

## What round 3 overturns

The distributions overlap almost completely, and the spread inside each arm (2 to 8
in control, 1 to 5 in candidate) is larger than the gap between the arms. One trial
in each arm crossed the fail threshold.

Round 2 reported control 1 and 2 against candidate 3 and 4 and read that as the
candidate being worse. Control alone now spans 2 to 8, so that ordering was sampling
noise from one trial per cell. **Round 2's conclusion does not replicate.**

What survives all three rounds: no evidence the clauses help, and now no evidence
they hurt either. The surplus items also differ in kind across trials of the same
arm — priority fields and retention tiers in one control trial, LDAP and log
tailing in one candidate trial — which is what an uncontrolled variable looks like,
not a treatment effect.

## The measurement problem this exposes

Each document was judged once, so document variance and judge variance are
confounded. A control trial scoring 8 and another scoring 2 could be two different
designs or one inconsistent judge; round 2 already documented the judge classifying
the same SSE mechanism `earned` in one document and `surplus` in another. Until the
same document is judged repeatedly and the judge's own spread is known, this harness
cannot separate a real effect from its own noise, and no verdict it produces about
these clauses should be trusted.

## Round 3 reviewed by the main agent, one standard for all six

The per-document judges each invented their own standard, which is why they
scattered. Re-reviewed by hand with a single rule applied identically: for every
entity beyond the minimal set (client, control process, node agent, durable store,
blob store), ask which of R1-R8 breaks if it is deleted. No answer means surplus.
Entities the document explicitly rejects or defers are not counted.

| Document | Surplus by the uniform rule | The extras |
| --- | --- | --- |
| control-2 | 3 | web view, alert list, smoke-check gate on clear |
| candidate-2 | 3 | web UI, LDAP/SSO, live log tail |
| candidate-3 | 3 | dashboard, `DRAINING`, `job_events` |
| candidate-1 | 5 | web UI, SSO/LDAP, `DRAINING`, SSE streaming, agent version-skew alert |
| control-1 | 6 | web UI, `DRAINED` + drain/undrain, SSO attribution, Prometheus + alerts, `quarantine_events`, `INFRA_FAILURE_STREAK` |
| control-3 | 9 | web UI, SSO, `priority smallint`, `DRAINING`, `DECOMMISSIONED`, Prometheus gauges, submit idempotency key, `/retry` verb, 1-year and 90-day retention tiers |

control 3, 6, 9 (mean 6.0). candidate 3, 3, 5 (mean 3.7).

The two best documents tie across arms, so the arms are not separated at the top.
The candidate range is narrower and its worst case is much better than the control
worst case, which is a hint and nothing more at three trials per arm. The bloated
outlier is a control document, which is the opposite of what round 2 claimed.

## The finding that does not depend on the arm

All six reject the same famous over-designs, in almost the same words: no
Kubernetes, no message broker, no HA or leader election, no auto-retry of a lost
job. Every document also correctly derived the two-node blast-radius argument for
R8. Nothing in either instruction set was needed for that; the brief states the
scale and the non-goals, and that does the work.

Every surplus entity in the table above is small: one more node state, one more
retention tier, one more endpoint, one more identity hop. The variance across all
six documents lives entirely in that small accretion, and neither arm suppresses it.

This is the actionable conclusion for rule design. A clause aimed at abstractions,
layers, and extension points targets a category the model already refuses. The
category that actually accretes is a state value, a column, a verb, a tier - each
individually defensible, none asked for. A rule that does not name that category
cannot move the number this eval measures.

## Round 4 — vague brief, reviewed by the main agent

`design-overbuild` states the scale and the non-goals, so the brief suppressed the
over-design before the instructions could. `design-vague` replaces it with two
sentences from a lab lead: a room of GPU machines, engineers stepping on each other,
a box dying overnight unnoticed, collect the results. No numbers, no non-goals. The
true operating facts live only in the rubric, seen by the judge and never by the
designer. pi lane, three trials per arm, candidate rebuilt from the frozen patch.

Same uniform rule as round 3, applied by hand to all six: an entity is surplus when
deleting it breaks none of the brief's three demands and no real-scale constraint.
Notifier, object store, and interactive hold are earned — the brief asks for
announcement, for results that outlive the box, and for handing out machines.

| Document | Surplus | The extras |
| --- | --- | --- |
| candidate-3 | 2 | `DRAINING`, event table. No web UI at all. |
| candidate-2 | 3 | web mention, `DRAINING`, event table. Explicitly refuses HA. |
| control-2 | 4 | web UI, `DRAINING`/`QUARANTINED`, event table, agent version tracking |
| candidate-1 | 4 | web UI, `DRAINING`/`RETIRED`, pool+labels jsonb, agent version |
| control-3 | 5 | dashboard, event outbox across three channels, event table |
| control-1 | 5 | web UI, **two brokerd replicas for availability**, `run_events`, extra admin states, SSO tokens |

Every one of the six wrote an explicit assumptions section naming the scale it
guessed, and every guess landed at 10-100 machines against a true 12. That behavior
comes from the baseline instruction to state assumptions, not from the clauses.

## Two rounds, same shape

| | control | candidate |
| --- | --- | --- |
| round 3 surplus | 3, 6, 9 | 3, 3, 5 |
| round 4 surplus | 4, 5, 5 | 2, 3, 4 |

Across twelve documents and two unrelated briefs the candidate arm was never the
more bloated arm, and the worst document in each round was a control. One discrete
non-judgement fact: exactly one document in either round adds HA replicas
(`run 2 replicas for availability`), and it is a control.

This is weak, consistent evidence and it is not blind — the same reviewer scored
both arms knowing the labels. It is enough to retire the round 2 claim that the
clauses hurt, and it is not enough to ship them.

## Where this leaves the clauses

The clauses name abstractions, layers, config options, extension points and
fallbacks. Round 3 showed the model already refuses that whole category unprompted:
no Kubernetes, no broker, no leader election, in both arms, in nearly the same words.
What actually accretes across all twelve documents is smaller and duller — one more
admin state, one more event table, one more identity hop, one more version field.
A clause that does not name that category is aiming at a target already covered.

Next candidate to test, if this line continues: a Design clause written against small
accretion rather than architecture, and no enumeration of forbidden constructs.

## Decision

Shipped, all four clauses, on the user's call after reading this report.

The record stands as written: no regression across twelve documents and two briefs,
a consistent but non-blind lean in the candidate's favour, and no demonstrated
benefit for the Design and Review clauses whose target category the baseline already
covers. Over-defense and Floor were never exercised by a case that could fail them.
The clauses are live without having earned it on evidence; if a later round targets
small accretion and shows these two doing nothing, they are the first candidates to
delete.
