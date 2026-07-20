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
   and applicable project/Wayne lessons.
2. Treat the decision log as the WHAT-level source of truth when present. Trace
   every source requirement and decision into the plan; HOW details are plan-owned.
3. Detect active-plan conflicts, unresolved product decisions, and missing E2E
   ownership before authoring. A conflict stops with `PLAN_CONFLICT`; a missing
   E contract stops with `MISSING_E2E`. Do not write a plan in either case.
4. Detect dead and legacy surfaces by tracing callers. Record approved cleanup;
   do not decide a product compatibility question without an upstream decision.
5. Order implementation units by dependency and make each unit executable by a
   fresh `wayne-work` agent without returning to product design.
6. Run deterministic validation plus two provider-agnostic independent reviews:
   source-fidelity (decisions/spec/E rows) and execution-readiness (unit closure,
   interfaces, files/symbols, U rows, dependencies, placeholders). Do not name or
   invoke a vendor-specific review skill.
7. Revise from findings and revalidate. Present the plan only when gates pass.
   Handoff through `wayne-checkpoint` to `wayne-work` unless the caller explicitly
   requests a return-only/no-checkpoint evaluation.

## State ownership and source fidelity

- `wayne-test-design` owns the E layer. Carry every E row byte-for-byte from the
  referenced matrix, including exact columns, wording, ID, and `⬜` status. Never
  author, drop, normalize, reorder, or status-mutate an E row.
- `wayne-plan` owns the U layer. Treat U-SEED rows as input, re-author them against
  real unit files/functions, and bind each U row to exactly one unit.
- Account for every source U-SEED exactly once: map it to one U row or put it in a
  `Dropped Seeds` table with a non-empty reason. Never both; `added` is permitted
  only for new U rows.
- Every feature-bearing unit owns at least one U row. Every U row names its real
  `path::symbol`, concrete input → action → expected result, and starts `☐`.
- Every carried E row is advanced by at least one unit. Only `wayne-verify` may
  change `⬜`; only `wayne-work` may change `☐`.
- Source-relative validation must accept the original decision log, spec, matrix,
  repository, and a pre-run manifest. An artifact-only check may not claim source
  fidelity or no-upstream-mutation proof.
- Requirement/decision discovery, semantic classification, and completeness are
  owned by contextual AI review. Deterministic validation may check hashes,
  literal existence, grammar, and closure over the supplied ledger, but must not
  infer source meaning from headings, IDs, keywords, substring scans, or regex.
- Cross-field repair preserves the most specific future surface. Validator success
  never justifies widening `Type.member` to `Type` or stripping a method owner.

## Canonical plan contract

Keep the detailed schema in one direct reference, an aligned template, and a
deterministic validator. `SKILL.md` owns procedure and gates, not a duplicate schema.

The plan is English Markdown at:

`docs/plans/YYYY-MM-DD-NNN-<feat|fix|refactor>-<3-5-word-name>-plan.md`

Its level-two sections, exactly once and in this order, are:

1. `## Overview`
2. `## Problem Frame`
3. `## Requirements Trace`
4. `## Scope Boundaries`
5. `## Context`
6. `## Key Technical Decisions`
7. `## Open Questions`
8. `## File Structure`
9. `## Implementation Units`
10. `## Test Matrix`
11. `## Dead Code / Legacy Cleanup`
12. `## System-Wide Impact`
13. `## Risks & Dependencies`
14. `## Sources & References`

`## Requirements Trace` uses exactly:

```markdown
| Requirement | Owning units |
|---|---|
```

Every source `R<number>` appears exactly once and maps to at least one unit.

Each unit heading is `### Unit I<number> — <name>`, in dependency order. Each unit
contains these non-empty level-four fields in this order:

1. `#### Goal`
2. `#### Requirements`
3. `#### Dependencies`
4. `#### Consumes`
5. `#### Produces`
6. `#### Files`
7. `#### Approach`
8. `#### Technical design`
9. `#### Patterns`
10. `#### Test scenarios`
11. `#### E rows`
12. `#### Verification`
13. `#### Decision trace`

Use exact sentinel `none — <reason>` when a field legitimately has no item.
Dependencies point only to earlier units. Interfaces use repo-relative
`path::symbol` surfaces; a `from I#` consumer resolves to that earlier unit’s
produced surface. File bullets name create/modify/delete plus a symbol and work.

`## Test Matrix` contains:

1. The E2E table copied verbatim from the source matrix, or the source literal
   `E2E: none — <reason>` when that is the approved upstream declaration.
2. One U table with exact header:

```markdown
| ID | Owner | Seed | Surface | Scenario | Status |
|---|---|---|---|---|---|
```

3. `### Dropped Seeds` with exact header:

```markdown
| Seed | Reason |
|---|---|
```

Ban placeholders in unit fields: `TBD`, `TODO`, “implement later”, “add error
handling”, “add validation”, “handle edge cases”, “write tests”, “similar to Unit”,
and references to undefined interfaces. Paths are repo-relative; do not include
git commands, commit messages, runnable framework code, or claim runtime unknowns
are settled.

## Blocking output contract

When planning is blocked, do not create a plan. Return exactly five non-empty lines:

```text
STATUS: BLOCKED
REASON: PLAN_CONFLICT or MISSING_E2E
ARTIFACTS: <semicolon-separated repo-relative paths>
OWNER: product-design or test-design
<one concise Chinese explanation>
```

For `PLAN_CONFLICT`, the owner is `product-design`. For `MISSING_E2E`, the owner
is `test-design`. Return the blocker artifact byte-for-byte after validation: no
preamble, code fence, or validation announcement.

## Resources and size

- Procedure archetype with one Flowchart owning conflict, missing-contract,
  validation/revision, success, and blocked terminals.
- `SKILL.md` target: 100-180 lines and 800-1,500 words; hard limit below 500.
- Remove the `Inherits`, `Files Written`, `Checklist`, repeated phase list, full
  pipeline tutorial, and gstack review sections when their information is already
  owned by metadata, Flow, the contract reference, or global instructions.
- Keep one-level resources only. Every shipped resource is linked directly.

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
