# Fusion table and decision-record template

Load this reference when writing `$STATE/runs/<topic>/fusion.md` in Node D (and updating it with Node R resolutions). `fusion.md` records how the two proposals were compared and chosen, and how the fused design answers the architecture bar. The design itself is `design.md` (SKILL.md Node D), and this table feeds its `## Alternatives considered` and `## Decisions`.

## `fusion.md` template

Write to `$STATE/runs/<topic>/fusion.md`:

```markdown
# Fusion: <topic>

## Proposal comparison

### 1. Proposals agree

| Point | A | B | Taken | Why (evidence) |
| --- | --- | --- | --- | --- |
| <topic> | <summary> | <summary> | A/B (agree) | <code/log/data pointer> |

### 2. Adopted from B

| Point | A | B | Taken | Why (evidence) |
| --- | --- | --- | --- | --- |
| <topic> | <summary> | <summary> | B | <verified evidence> |

### 3. Rejected

| Point | A | B | Taken | Why (evidence) |
| --- | --- | --- | --- | --- |
| <topic> | <summary> | <summary> | A (rejected B) / neither | <concrete reason or contradicting evidence> |

### 4. Undecidable (routed to G)

| Point | A | B | Taken | Why (evidence) |
| --- | --- | --- | --- | --- |
| <topic> | <option A> | <option B> | pending G | <both defensible; evidence and the architecture bar do not separate; changes outcome> |

## Architecture bar (fused design)

| Check | Answer | Evidence | Carried as |
| --- | --- | --- | --- |
| <1–9 and its name> | yes / no / n/a | <design section or `path::symbol`> | `R<n>` / Invariants line / `D<n>` (accepted cost) / — |

## R resolutions (only if Node R ran)

| # | Suggestion | Resolution | Why (actual feature behavior) |
| --- | --- | --- | --- |
| 1 | <copy or interaction change> | Adopted / Rejected | <verified reason> |
```

## Four row groups

Place every compared point in exactly one group:

1. **Proposals agree:** A and B converge on the same choice; record the supporting evidence.
2. **Adopted from B:** Gemini's claim was verified against code, logs, or production data (including any `[guess]` item) and chosen over A.
3. **Rejected:** A proposal point was rejected with concrete evidence or reason (for example, unverified guess, contradicts code/spec, or unnecessary complexity).
4. **Undecidable:** both options are defensible, repository/runtime evidence cannot separate them, the architecture bar does not separate them, and the choice changes the outcome. Route these rows to Node G.

When the architecture bar decides a row, the row goes to group 2 or 3 like any other taken row, and its `Why (evidence)` cell names the check number that separated the options.

## Architecture bar table

The checks are defined in [the architecture bar](../../wayne-mind-explode/references/architecture-bar.md); do not restate them here. Fill one row per check for the fused design, after the proposal comparison is complete:

- `Answer`: `n/a` only when the design has nothing the check can apply to (for example, no automatic loop for check 9).
- `Evidence`: the place in the design or the repository that the answer rests on. An answer without a place is not an answer.
- `Carried as`: for a "yes" that the design depends on, the `R<n>` or the `## Invariants` line in `design.md` that turns it into a check. For a "no" that stays, the `D<n>` that records the accepted cost. Use `—` for checks 3 and 7 and for answers that the design does not depend on.

## Decision-record mapping (`decision-log.jsonl`)

Append one `decision` record to `$STATE/runs/<topic>/decision-log.jsonl` for every taken row in groups 1–3 (using the schema from `../../_shared/pipeline-id-contract.md`):

- `id`: next consecutive `D<number>` (continuing any living spec's numbering).
- `question`: the compared point.
- `decision`: the taken choice.
- `source` and `reference`:
  - `"codebase"` with a repository-relative path when repository code/logs settled the point.
  - `"web"` with an `http(s)` URL when external documentation settled the point.
  - `"default"` with `reference: null` when evidence did not uniquely settle a minor choice and the main model picked the default.
  - `"constraint"` with `reference: null` when the architecture bar separated two options that evidence left equal; `rationale` names the check number.
- `rationale`: name which proposal (`A`, `B`, or `both`) the choice came from and state the evidence or reason.
- `consequences`: accepted cost or trade-off (`null` only if none).
- `supersedes`: `[]` unless reversing an earlier decision (reversing a living-spec decision routes to `wayne-mind-explode` instead).
