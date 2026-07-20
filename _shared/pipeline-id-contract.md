# Wayne pipeline identifier contract

This file is the single owner of identifiers exchanged between Wayne stages.
Producer and consumer skills link here; they do not redefine or infer namespaces.

## Canonical namespaces

| ID | Owner | Meaning |
|---|---|---|
| `N<number>` | `wayne-mind-explode` | decision-DAG node |
| `D<number>` | `wayne-mind-explode` | durable decision-log row |
| `F<number>` | design/code review owner | review finding; never a requirement |
| `R<number>` | approved spec/test design | product requirement |
| `S<number>` | `wayne-test-design` | provisional U-SEED row |
| `I<number>` | `wayne-plan` | implementation unit |
| `U<number>` | `wayne-plan` | unit/integration test row |
| `E<number>` | `wayne-test-design` | E2E contract row |

Canonical numbers are positive decimal integers without leading zeroes. IDs are
recognized only in their defining bounded table or section; a matching token in
prose, another table, a review report, or a filename has no cross-stage meaning.
Never inventory IDs by scanning a whole file for `R\d+`, `D\d+`, or similar tokens.

## Defining structures

The decision log owns decisions in exactly one table:

```markdown
| ID | Question | Decision | Rationale | Source |
|---|---|---|---|---|
| D1 | ... | ... | ... | user |
```

The approved product/spec owner assigns `R<number>` to requirements. Consumers
recover that set by reading the source in context and recording exact clauses in a
temporary ledger. A heading, table shape, ID prefix, keyword, substring, or regex
is never proof that the inventory is complete or that an `R1` token is a product
requirement rather than a legacy review resolution. New review findings use
`F<number>`.

The test matrix defines `S<number>` only in its bounded `## U-SEED` table and
`E<number>` only in its bounded E2E contract table. The plan defines `I<number>`
and `U<number>` only in its Implementation Units and Test Matrix sections.

## Legacy read compatibility

- A legacy decision table with the same five columns and header `#` may contain
  bare positive integers. Consumers map row `1` to canonical `D1`, preserving the
  complete source row as evidence.
- A legacy three-column `ID | Decision | Rationale` table with canonical `D<number>`
  values is also readable. Producers must use the current five-column form.
- A legacy U-SEED table may use `U<number>` in its first column. Preserve that seed
  ID byte-for-byte in the ledger; it does not become a plan-owned U row.
- A legacy U-SEED or E2E table may label its first column `#`; consumers recognize
  the row value (`U<number>`/`E<number>`) and preserve the header byte-for-byte.
- Legacy review IDs keep their original bytes as evidence but never enter the
  requirement namespace merely because they start with `R`.

Compatibility is read-only. No downstream stage may rewrite an upstream decision
log, spec, matrix, or review report to normalize IDs. Canonical aliases belong in
temporary ledgers or newly authored downstream artifacts.

## Artifact state and field owners

| Artifact / field | Sole writer | Lifecycle |
|---|---|---|
| decision-log rows, DAG, status | `wayne-mind-explode` | `in-progress` → `design-approved`; downstream read-only |
| spec requirements `R<number>` | `wayne-mind-explode` / approved product-design stage | frozen before test design and planning |
| U-SEED definitions and seed Status | `wayne-test-design` | authored as `S<number>` + `☐`; downstream preserves source bytes |
| authoritative E table | `wayne-test-design` | lives in one `docs/test-matrix/` artifact as `E<number>` rows |
| authoritative E Status | `wayne-verify` | test design initializes `⬜`; Verify alone changes the authoritative matrix to `✅/❌` |
| plan E snapshot | `wayne-plan` | byte-for-byte design-time derived view; remains `⬜` and is never a status owner |
| plan structure, `I<number>`, `U<number>` definitions | `wayne-plan` | `active` while drafting → `approved` only after deterministic validation and both reviews |
| U Status | `wayne-work` | Plan initializes `☐`; Work alone changes it to `☑` after owned verification |
| checkpoint/handoff snapshot | `wayne-checkpoint` | derived copy only; never changes source IDs or statuses |

`wayne-work` accepts only an `approved` plan. A handoff carries the exact
`docs/test-matrix/` path; `wayne-verify` mutates E Status only there, never in the
plan snapshot. A milestone or status change permits
the next manual stage; it never authorizes a skill to invoke that stage implicitly.

A converged direct request may enter `wayne-plan` without Mind Explode, a decision
log, or a spec. Plan may nest `wayne-test-design` solely to obtain the owned matrix;
the nested call returns to Plan and does not count as pipeline auto-advance.
