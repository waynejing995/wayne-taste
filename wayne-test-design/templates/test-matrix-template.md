---
title: "[Feature] Test Matrix"
type: test-matrix
status: active
scope: run          # working state; absorbed into the spec at ship, then deleted
date: YYYY-MM-DD
origin: docs/specs/<topic>.md
decisions: <the run-scoped decision log for this run>
---

# [Feature] Test Matrix

<!-- This is a readable starting layout. Preserve the information and ownership
     contract; adapt headings, grouping, or table presentation when clearer. -->

## Overview

[What this matrix covers — 1-2 sentences. Name the feature and its source spec/plan.]

## Requirements Trace

- R1. [Requirement] → covered by [S1, E1]
- R2. [Requirement] → covered by [S3]
- R3. [Requirement] → covered by [E2]

Coverage summary: [R1✓ R2✓ R3✓ | seed: S1-Sn | e2e: E1-En]

## Dimensions Considered

The dimension menu walked for this feature. Dimensions structurally absent from the
behavior are omitted entirely (not listed as `none`). Only reviewer-surprising deliberate
gaps appear as `none — reason` under their unit.

[List which dimensions are in play for this feature, one line each, e.g.:
- positive, negative, invalid, persistence — apply broadly
- concurrency — omitted: single-writer admin action, no shared mutable row
- boundary — omitted: no numeric/size limits in this feature]

---

## Layer 1: Unit / Integration

### U-SEED (wayne-plan re-authors + locks)

Developer / `wayne-work` ticks `☐ → ☑` when the test passes. These do **not** gate
`wayne-verify` or `wayne-ship`'s e2e check.

`unit` = isolated, mocks OK. `integration` = crosses a real seam (real DB / real service),
mocks discouraged.

| ID | Behavior seed | Dimension | Case | Layer | Status |
|---|------|-----------|------|-------|--------|
| S1 | [unit] | positive | [concrete precondition, action, and observable result] | unit | ☐ |
| S2 | [unit] | invalid | [invalid boundary and observable rejection behavior] | unit | ☐ |
| S3 | [unit] | persistence | [write/reload boundary and observable persisted result] | integration | ☐ |

[If no U-SEED scenario is sound, state that explicitly with a reviewable reason.]

Declared gaps (reviewer-surprising dimensions deliberately excluded):

- [U-name] [dimension]: none — [reason a reviewer can challenge]

---

## Layer 2: E2E Verification Contract

This layer **is** the E2E Verification Contract. Its information and ownership come
from `../../_shared/e2e-contract.md`; the table below is the recommended compact view, not
a grammar. All Status start `⬜`. **Only `wayne-verify` flips `⬜ → ✅ / ❌`.** A
passing unit suite never touches this layer.

### E2E Proof-Axis Audit

- Functional rows (provider-specific): [provider → row #s]
- Attestation rows (provider-specific): [provider → row #s → native runtime evidence]
- Aggregate rows: [row #s → cross-provider behavior that requires aggregation]
- Resilience/cleanup rows (provider-specific): [provider → row #s]
- Explicit weaker/unverified rows: [row #s → supported public mode → `POLICY UNVERIFIED` observable]
- Capability conflicts requiring scope resolution: [requirement → missing native proof, or "none"]

### UI Control Graph

[Omit this section entirely when the behavior has no user interface.]

| Node (reachable state) | Visible controls | Edge rows |
|---|---|---|
| [overview] | [New run, Open run, Refresh] | [E2, E3, E4] |
| [start dialog step 1] | [repo checkbox, Next (disabled until ticked)] | [E5, E6] |

Every control listed appears as exactly one `edge` row; a control with no row is a hole
in the matrix. This graph enumerates what EXISTS — it cannot show a control the product
needs and nobody wrote, which is what the `goal-walk` rows are for.

User goals walked end to end (one `goal-walk` row each, and these gate the change):

- [an engineer turns a conversation into a spec] → [E1]

Each row below has one primary proof axis, one kind (`goal-walk` / `edge` / `path`), and
one proof layer. A prerequisite that can fail before the target behavior has its own
`path` row. Flags, argv, and help text show intent, not effective capability. Evidence
from below a row's declared proof layer never closes it.

| ID | Kind | User path | Proof layer | Env: process | Env: data | Env: entrypoint | Observable (pass = ?) | Status |
|---|---|-----------|---|--------------|-----------|-----------------|----------------------|--------|
| E1 | goal-walk | [the whole user goal, end to end] | [browser] | [process to start] | [data it runs against] | [where user enters] | [arrived at the goal's terminal state — never an optimistic intermediate] | ⬜ |
| E2 | edge | [click New run on overview] | [browser] | [process to start] | [data it runs against] | [where user enters] | [the state change: URL, dialog, new list row] | ⬜ |
| E3 | path | [prerequisite / attestation / cleanup journey] | [cli] | [process to start] | [data it runs against] | [where user enters] | [native evidence for this row's axis] | ⬜ |

[If a requirement has no user-observable path, write the explicit line instead of a row:]
E2E: none — [reason, e.g. "internal repository refactor, no behavior change"]

---

## Provenance

- Absorbed e2e contract draft from spec: [yes — now superseded by this matrix / no draft existed]
- KB lessons matched: [list with paths, or "none matched"]
- Regression rows (if from a bug report): [row #s, or "n/a"]
