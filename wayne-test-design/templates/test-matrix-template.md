---
title: [Feature] Test Matrix
type: test-matrix
status: active
date: YYYY-MM-DD
origin: docs/specs/YYYY-MM-DD-<topic>-design.md
decisions: docs/decisions/YYYY-MM-DD-<topic>-decisions.md
---

# [Feature] Test Matrix

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

[If no U-SEED row is sound, keep the heading and table header, omit example rows,
then write `U-SEED: none — <reason>`.]

Declared gaps (reviewer-surprising dimensions deliberately excluded):

- [U-name] [dimension]: none — [reason a reviewer can challenge]

---

## Layer 2: E2E Verification Contract

This layer **is** the E2E Verification Contract. Format is LOCKED by
`_shared/e2e-contract.md` — do not redefine columns. All Status start `⬜`. **Only
`wayne-verify` flips `⬜ → ✅ / ❌`.** A passing unit suite never touches this layer.

### E2E Proof-Axis Audit

- Functional rows (provider-specific): [provider → row #s]
- Attestation rows (provider-specific): [provider → row #s → native runtime evidence]
- Aggregate rows: [row #s → cross-provider behavior that requires aggregation]
- Resilience/cleanup rows (provider-specific): [provider → row #s]
- Explicit weaker/unverified rows: [row #s → supported public mode → `POLICY UNVERIFIED` observable]
- Capability conflicts requiring scope resolution: [requirement → missing native proof, or "none"]

Each row below has one primary proof axis. A prerequisite that can fail before the target
behavior has its own row. Flags, argv, and help text show intent, not effective capability.

| ID | User path | Env: process | Env: data | Env: entrypoint | Observable (pass = ?) | Status |
|---|-----------|--------------|-----------|-----------------|----------------------|--------|
| E1 | [human journey end to end] | [process to start] | [data it runs against] | [where user enters] | [real user-visible outcome — never "200 OK"] | ⬜ |

[If a requirement has no user-observable path, write the explicit line instead of a row:]
E2E: none — [reason, e.g. "internal repository refactor, no behavior change"]

---

## Provenance

- Absorbed e2e contract draft from spec: [yes — now superseded by this matrix / no draft existed]
- KB lessons matched: [list with paths, or "none matched"]
- Regression rows (if from a bug report): [row #s, or "n/a"]
