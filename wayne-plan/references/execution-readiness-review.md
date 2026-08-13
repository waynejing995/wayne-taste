# Execution-readiness review protocol

Use this protocol for the independent execution review after drafting. The [plan contract](plan-contract.md) owns the required information and the [source-fidelity protocol](source-fidelity-review.md) owns upstream faithfulness. This review asks one question only: could a fresh `wayne-work` agent execute this plan from the plan plus the repository, without redesigning the product or inventing behavior?

Judge the plan as written. Do not repair it in your head, do not assume the author knows something the plan omits, and do not accept a reasonable-sounding unit whose inputs, symbols, or decisions do not exist yet.

## Dependency closure

Read the units in order and simulate execution.

- Every input a unit consumes is either already present in the repository or produced by an earlier unit in this plan. A forward reference is a failure.
- Every output a unit produces has a named consumer, or an explicit statement that it is terminal. An orphan output is dead state.
- Ordering reflects real data and control dependencies, not narrative convenience. If unit N reads what unit N+2 writes, the order fails.

## Real files and symbols

- Every `path::symbol` resolves in the repository at the reviewed revision, or the plan states plainly that the unit creates it and where.
- A renamed, moved, or already-deleted surface cited as if it still exists fails.
- Interface changes name their callers and external consumers. An unlisted caller that the repository shows is a failure, not a detail.

## Closed control logic

- Each unit states concrete behavior: the branch conditions, the error and failure paths, the ordering or state timing that matters, and what is deliberately out of scope.
- Vague direction is not executable. "Handle errors appropriately", "update the relevant callers", "refactor as needed", and "wire it up" are failures, because two implementers would produce different systems from the same words.
- Where the plan silently picks a product behavior that no approved source decided, that is an upstream gap, not a plan detail. Report it as a decision the plan is not allowed to make.

## Ownership and coverage

- Every unit owns its test work explicitly, and every U scenario in the plan binds to exactly one unit. An unbound scenario and a shared scenario are both failures.
- The E block is a read-only snapshot. A plan that advances, edits, or re-owns E status fails.
- Verification per unit is observable: the reader can tell what to run or inspect and what result means done.

## Cleanup and placeholders

- Replaced functions, routes, jobs, configuration, and public interfaces are classified dead, legacy, or shared, with the classification traceable to the repository rather than asserted.
- No placeholder survives: no `TBD`, no unnamed file, no unresolved alternative, no "decide during implementation".

## Scope evidence

Compare the freeze-time git state against the declared allowed mutation paths. Any authored change beyond the new plan file is a scope failure. Git evidence is sufficient; do not scan unrelated files.

## Non-oracles

Headings, section order, table shape, ID prefixes, keyword or substring matching, regex, scripts, and agreement with the template are never evidence of readiness. A plan can satisfy every heading and still be unexecutable, and a plan can reorder or merge sections and still be complete. Read for meaning.

## Reporting

Report each defect at the smallest surface that owns it: upstream gap, plan content, template guidance, or coverage-map transcription. Severity follows the harness definitions — a unit a fresh agent cannot execute as written is a BLOCKER. Return the harness-provided JSON object; add no prose wrapper.
