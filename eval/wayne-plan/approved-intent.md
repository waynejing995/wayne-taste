# Approved intent: optimize wayne-plan

Revise the existing `wayne-plan` procedure skill into the smallest reliable owner
of Wayne implementation-plan authoring. Preserve its downstream contract with
`wayne-test-design`, `wayne-work`, `wayne-verify`, and `wayne-checkpoint`; remove
generic planning advice and deprecated/tool-specific review machinery.

## Trigger and boundary

- Keep the skill name `wayne-plan` and the current trigger family: “plan this”,
  “create a plan”, “implementation plan”, “how do we build this”, and equivalent
  Chinese requests.
- Use it for a durable implementation plan from an approved decision log, spec,
  test matrix, or already-converged direct request.
- Do not use it to brainstorm unresolved product behavior, design a test matrix,
  implement code, run the feature, commit, ship, or silently choose a compatibility
  policy.
- Never invoke or depend on gstack or any gstack-named skill.

## Procedure and failure terminals

1. Discover inputs in priority order: decision log, spec, then direct request.
   Read the referenced test matrix, relevant repository files/tests, active plans,
   and applicable project/Wayne lessons. Match each lesson from its trigger by
   contextual meaning; carry a relevant lesson's title/path, trigger, prevention,
   and concrete mitigation, exclude non-matches as constraints, and explicitly
   record none/dismissed outcomes.
2. Treat the decision log as the WHAT-level source of truth when present. Trace
   every source requirement and decision into the plan; HOW details are plan-owned.
3. Detect active-plan conflicts, unresolved product decisions, and missing E2E
   ownership before authoring. A conflict stops with `PLAN_CONFLICT`; a missing
   E contract stops with `MISSING_E2E`. Do not write a plan in either case.
4. Detect dead and legacy surfaces by tracing callers. Record approved cleanup;
   do not decide a product compatibility question without an upstream decision.
5. Order implementation units by dependency and make each unit executable by a
   fresh `wayne-work` agent without returning to product design.
6. Run two provider-agnostic independent reviews:
   source-fidelity (decisions/spec/E rows) and execution-readiness (unit closure,
   interfaces, files/symbols, U rows, dependencies, placeholders). Do not name or
   invoke a vendor-specific review skill.
7. Revise from findings and repeat both reviews. Present the plan only when gates pass.
   Keep the plan English and the default user-visible summary concise Chinese unless
   the caller supplied an exact output contract.
   Handoff through `wayne-checkpoint` to `wayne-work` unless the caller explicitly
   requests a return-only/no-checkpoint evaluation.

## State ownership and source fidelity

- `wayne-test-design` owns the E layer. Carry every E entry without changing its
  meaning, wording, ID, order, or `⬜` status. Never author, drop, normalize, or
  status-mutate an E entry.
- `wayne-plan` owns the U layer. Treat U-SEED rows as input, re-author them against
  real unit files/functions, and bind each U row to exactly one unit.
- Account for every source U-SEED exactly once: map it to one U row or put it in a
  `Dropped Seeds` table with a non-empty reason. Never both; `added` is permitted
  only for new U rows.
- Every feature-bearing unit owns at least one U row. Every U row names its real
  `path::symbol`, uses non-empty prose whose input/action/observable meaning is
  judged by contextual AI review, and starts `☐`. Arrow count and sentence shape
  are not requirements.
- Every carried E row is advanced by at least one unit. Only `wayne-verify` may
  change `⬜`; only `wayne-work` may change `☐`.
- Source-fidelity review reads the original decision log, spec, matrix, repository,
  working coverage map, and plan. Starting Git state, agent write history, and final
  diff prove the plan-only mutation boundary.
- Requirement/decision discovery, semantic classification, completeness, ownership,
  and plan readiness are owned by contextual AI review. Headings, IDs, keywords,
  substring scans, regex, table shape, and template agreement cannot decide them.
- Cross-field repair preserves the most specific future surface; textual equality
  never justifies widening `Type.member` to `Type` or stripping a method owner.

## Plan information contract

The plan is English Markdown under `docs/plans/` with lightweight lifecycle and
source metadata. The template is a readable starting point, not a grammar.

The plan must preserve the problem, requirements, boundaries, decisions, rationale,
repository context, applicable lessons, open questions, dependency-ordered units,
files and interfaces, concrete approach, cleanup, risks, U/E ownership, verification,
and authoritative source links. Every requirement and decision traces forward; each
feature unit has useful U coverage; every source seed is mapped or dropped once with
evidence; and E information remains under its upstream/downstream owner.

Headings, section order, sentinel wording, tables, arrows, code-fence tags, and
phrase lists are presentation. Independent source-fidelity and execution-readiness
reviews decide whether the plan is complete, portable, concrete, and executable
without inventing a product decision.

## Blocking output contract

When planning is blocked, do not create a plan. Return a compact blocker carrying:

```text
STATUS: BLOCKED
REASON: PLAN_CONFLICT or MISSING_E2E
ARTIFACTS: <semicolon-separated repo-relative paths>
OWNER: product-design or test-design
<one concise Chinese explanation>
```

For `PLAN_CONFLICT`, the owner is `product-design`. For `MISSING_E2E`, the owner
is `test-design`. The example is an AI communication convention, not a line-count
or byte-level schema.

## Resources and size

- Procedure archetype with one Flowchart owning conflict, missing-contract,
  validation/revision, success, and blocked terminals.
- `SKILL.md` target: 100-180 lines and 800-1,500 words; hard limit below 500.
- Remove the `Inherits`, `Files Written`, `Checklist`, repeated phase list, full
  pipeline tutorial, and gstack review sections when their information is already
  owned by metadata, Flow, the contract reference, or global instructions.
- Keep one-level resources only. Every shipped resource is linked directly.

## Historical intent dispositions

| Historical behavior | Disposition | Current owner and reason |
|---|---|---|
| Plan changes the decision-log status to `plan-complete` and writes its plan link | superseded; do not restore | `_shared/pipeline-id-contract.md` makes decision-log rows/DAG/status read-only after `design-approved`; the plan owns approval and `wayne-checkpoint` owns the derived handoff link |
| Plan presents a Chinese summary for an English file | preserved | `wayne-plan` presentation step |
| Lesson recall uses semantic trigger matching and records relevant/none/dismissed outcomes | preserved | `wayne-plan` discovery plus `Context / Applicable Lessons` in the plan contract |

## Evaluation contract

- Preserve the current skill as control.
- Run fresh Claude and Codex agents on the same normal, active-conflict, and
  missing-E2E repository fixtures.
- Correct stopping behavior is a hard gate. Provider/tool-use termination without
  an observable result is invalid, not a loss.
- For the normal case, run a frozen external checker with original source inputs,
  then hand the plan alone to a fresh implementation agent in the runnable fixture.
- Accept only with no task-success or safety/ownership regression. Size and cost are
  tie-breakers after behavior.
