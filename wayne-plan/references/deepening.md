# Deepening

Loaded from SKILL.md node DP, on the `F -> G` edge. Standard path only; a lite plan never deepens.

Review asks what is **wrong**. It is adversarial and finding-driven, so a plan that breaks no rule passes. Deepening asks what is **thin** — a decision stated without its rationale, a unit whose Approach restates its Goal, a test scenario that says "validates correctly", a pattern cited in Context that no unit ever follows. None of those is a finding. All of them cost a `wayne-work` agent real time.

It runs before the voices deliberately: the reviews are then the quality gate on what deepening changed. Running it after G would invalidate all three passes.

## 1. Score

Per section: **trigger count** (checklist hits below) **+1** when the topic is high-risk and this section is materially part of that risk **+1** when it is one of the five sections below. A section is a candidate at **2 points**, or at **1 point** when the domain is high-risk and the section is materially important.

The count of candidates decides what happens next, and there are three outcomes — not one:

| Candidates | Outcome |
| --- | --- |
| **0** | The plan is already strong. Go straight to G; deepening spends nothing. |
| **1-5** | Deepen those sections. |
| **more than 5**, or any single critical section hitting most of its checklist | **The plan is not deepenable. Return to F and redraft.** |

That third row is the one that matters. A plan where everything is thin was not finished at F, and neither deepening nor review is the right instrument for it: strengthening five sections still leaves the rest thin, and spending three review dispatches on it buys a findings list that says what the author already knows. Say which sections failed and what they are missing, and redraft. A plan too thin to deepen is too thin to review.

When the plan is deepenable, take the top 2-5 and no more. If it already carries `deepened:`, prefer sections not yet strengthened when scores are close.

## 2. Checklists

Five sections carry checklists. The others in the template are structural (`Sources & References`, `File Structure`, `Scope Boundaries`) or thin by design — strengthen one only when it is materially load-bearing for this plan's risk.

**Key Technical Decisions**

- a decision states its conclusion with no rationale
- the rationale does not name the tradeoff or the rejected alternative
- the decision does not connect back to a requirement, scope boundary, or upstream decision
- an obvious design fork exists and the plan never says why one side won
- a decision restates a rule an `R<number>` already owns instead of citing it

**Implementation Units**

- dependency order is unclear or likely wrong
- a file path or test path that should be explicit is missing
- a unit is too large, too vague, or split into micro-steps
- Approach is thin, or names no existing pattern to follow
- test scenarios are vague, skip a category the unit warrants (no error path for a unit with failure modes, no integration scenario for a unit crossing layers), or are disproportionate to the unit
- a behavior-bearing unit has no U row
- Verification names no observable result, only a command

**System-Wide Impact**

- an affected interface, callback, entry point, or parity surface is missing
- failure propagation across the boundary is unexplored
- state lifecycle, caching, or data-integrity risk is absent where the change touches persistence
- the change is exposed through more than one interface and only one is planned

**Risks & Dependencies**

- a risk is listed with no mitigation or owner
- rollout, migration, or rollback treatment is missing where the change warrants it
- an external dependency assumption is unstated
- security, privacy, performance, or data risk is absent where it obviously applies

**Open Questions**

- a product blocker is hiding as an assumption
- a plan-owned question is deferred to implementation
- a resolved question has no basis in repository evidence or an upstream decision
- a deferred item is too vague to act on later

**Cross-check, always.** Use the plan's own `Context` and `Sources & References` as evidence: a pattern, lesson, or risk cited there that never reaches a decision, a unit, or a verification is itself a confidence gap in the section that should have used it.

## 3. Report, then dispatch

State the selection before spending anything:

```
Strengthening <sections> — <one reason each, naming the triggers that fired>
```

Then dispatch **one read-only subagent per selected section**, in parallel, **1-3 per section and at most 8 in total**. There are no persona files: seed a generic subagent with the section's checklist, and give it

- a short summary of the plan,
- the section's exact current text,
- which triggers fired and why the section was selected,
- one specific question to answer.

Require it to return findings that change planning quality — stronger rationale, sequencing, verification, risk treatment, or a repository reference — and forbid it implementation code, shell commands, and edits of any kind. Prefer repository and `WAYNE_KB_DIR` evidence over external sources; go external only when the gap cannot be closed from the repository. When two agents conflict, repository-grounded evidence beats generic advice and official documentation beats a secondary summary; a real remaining tradeoff is recorded in the plan rather than resolved silently.

Keep the returns inline. Only when the selection is large enough that inline returns would crowd the context, have each agent write one compact file into a fresh `mktemp -d` directory and return a one-line summary — outside the repository, never `.wayne/`, so the scope proof still holds.

## 4. Strengthen

Only the selected sections, and only what an agent's finding supports.

**Tighten as well as grow.** A section is strengthened by cutting: collapse a sentence carrying two ideas, drop hedges, and delete superseded text outright rather than leaving it struck through or stacking a resolutions layer on top of it. A shorter contradiction-free section is a stronger one.

**Strengthen at the owning entry.** A rule owned by an `R<number>` or a decision gains its evidence and precision at that entry; a sibling section that needs it cites the owning ID. Deleting an unlinked restatement found in a strengthened section is itself a valid tightening move. Synthesis folds findings back section by section, which is exactly where duplicate restatements creep in.

Allowed: tighter prose; stronger decision rationale; reordering or splitting units when sequencing is weak; missing pattern references, paths, or observable verification results; expanded impact, risk, or rollout treatment; reclassifying an open question between resolved and deferred; setting `deepened: YYYY-MM-DD`.

Not allowed: implementation code, git or test command recipes, a generic "research insights" subsection, rewriting the plan from scratch, or inventing a requirement, scope change, or success criterion without surfacing it. A product-level ambiguity found here is recorded under `Open Questions` and routed upstream — never decided here.

**IDs never move.** Reordering units preserves their existing `I<number>` and `U<number>`; splitting keeps the original number on the original concept and gives the new unit the next unused one; a deletion leaves its number unused. `wayne-work` and `wayne-checkpoint` reference these numbers, and deepening is the likeliest place to renumber them by accident, because the new order always looks tidier numbered sequentially.

## 5. Check the output before G

The three voices are the quality gate on this work, but two failures are structurally invisible to them, so the main agent checks those itself against the pre-deepening bytes:

1. **Every `I<number>` and `U<number>` survives with its number unchanged.** Both voices pass a renumbered plan — source-fidelity still sees the obligation carried, execution-readiness still sees an internally consistent plan. Neither compares against the previous revision.
2. **`## Review Adjudication` and every decision trace line only grew.** A finding recorded `stands` is permanently non-blocking _because that row exists_; deleting it makes the plan look cleaner and silently re-arms the finding.

Either check failing rolls the strengthening back. It is not a finding and does not enter adjudication — deepening produces no findings, and nothing it wrote may reach `## Review Adjudication`.
