# Lite planning

Loaded from SKILL.md node S when this run has **no decision log**. It replaces nodes A, B, E, and F; everything from the review gate onward is unchanged.

No decision log means no design run just handed off, so there are no `R<number>`s to trace, no U-SEED rows to re-author, and no decisions to map. The standard path exists to carry those obligations forward. Without them its template is thirteen empty sections, and empty sections are finding noise, not rigor.

This is the proportionate path for a converged direct request — a logic error, a small feature, a contained fix. It is **not** a lower standard: the same U rows, the same E contract, the same reviews, the same downstream owners. What it drops is bookkeeping for obligations that do not exist.

## What still applies

|  |  |
| --- | --- |
| Node C | An active conflict still returns `PLAN_CONFLICT`. |
| Node D | E ownership is still required: an owned E table, or the literal `E2E: none — <reason>`. Nest `wayne-test-design` when there is no matrix. |
| Node G onward | Reviews, ADJ, N, present, checkpoint handoff — unchanged. |
| Boundary | Only the new plan file changes. |

A living spec may exist even with no decision log — an old topic getting a small change. Read it as context and cite it; do not trace every `R<number>` in it, and do not amend it. Because it exists, the design-conformance voice applies.

## Research — three fixed lanes, dispatched together

This is where a lite plan earns its keep. The failure this path exists to prevent is changing something and discovering its other callers afterwards, so research is the one step that gets **more** attention here, not less.

Dispatch these three as parallel subagents in one batch. They are fixed: do not expand the set by judgment, and do not skip one because the change "looks contained" — that judgment is the thing being checked.

1. **Blast radius.** Who calls or consumes the surface being changed — direct callers, and indirect consumers such as jobs, scripts, CLI entry points, APIs, and other repositories. Classify each as dead, legacy, or shared. Report exact `path::symbol` plus how it consumes the surface.
2. **Existing test coverage.** Which tests already exercise this behavior, whether any currently asserts the wrong expectation, and whether the seam is mocked past the real chain. This decides where RED comes from: an existing failing test, an updated one, or a new one.
3. **Pattern to follow.** How the repository already does this kind of thing, named as a concrete `path::symbol` to mirror.

Each lane returns findings and evidence only; none of them edits anything. Their output lands directly in the plan's second and third sections.

If lane 1 finds a consumer whose compatibility policy is not already decided — a deletion, a deprecation, a migration — that is an unresolved product choice. Return to node C; do not pick delete, preserve, or deprecate here.

## The plan — four sections

Same frontmatter and filename convention as the standard template. Four sections, and nothing that would be empty:

```markdown
## What changes

<The behavior before and after, in one short paragraph. Then the units.>

### Unit I1 — <name>
- Files: <create|modify|delete `path::symbol`> — <the concrete work>
- Approach: <the actual control logic, not a restatement of the goal>
- Pattern: <`path::symbol` from research lane 3>
- Verification: <the exact command, and the observable result that means it passed>

## What this touches

<From research lane 1. Every caller and consumer found, each classified
 dead / legacy / shared, each with the approved action. A surface with no
 decided compatibility policy is a blocker, not a row.>

| Surface | Consumer | Class | Action |
|---|---|---|---|

## How it is proved

<U rows bound to units, from research lane 2 — say whether each is a new test,
 an updated existing one, or an existing one already failing.>

| ID | Unit | Test surface | Scenario | Status |
|---|---|---|---|---|
| U1 | I1 | `path::symbol` | <precondition, action, observable result> | ☐ |

<Then the E contract, carried unchanged from the matrix, or the literal line:>
E2E: none — <reason>

## Sources

- Origin: <the direct request, quoted or summarized>
- Living spec: <path, or `none`>
- Repository evidence: <`path::symbol` the research lanes returned>
```

`Design conformance: none — <reason>` goes in `## Sources` when no living spec exists.

Add a section only when it carries something a `wayne-work` agent cannot execute without. Never add one to look thorough.

## Boundaries of this path

- **Do not** open a decision log, write to `docs/specs/`, or run a decision DAG. If the WHAT is not settled, this is not a lite plan and not a standard plan — it is `wayne-mind-explode`, and this run stops and says so.
- **Do not** invent `R<number>`s. Requirements are minted only in a spec's `## Requirements`; a lite plan traces to the request itself.
- **Do not** skip node D. A small change with a user-visible effect still needs its E row, and one with none still needs to say so.
