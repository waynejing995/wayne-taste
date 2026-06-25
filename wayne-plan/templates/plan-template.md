---
title: [Plan Title]
type: [feat|fix|refactor]
status: active
date: YYYY-MM-DD
origin: docs/specs/YYYY-MM-DD-<topic>-design.md
decisions: docs/decisions/YYYY-MM-DD-<topic>-decisions.md
---

# [Plan Title]

## Overview

[What is changing and why — 2-3 sentences]

## Problem Frame

[User/business problem and context. Reference origin doc.]

## Requirements Trace

- R1. [Requirement this plan must satisfy]
- R2. [Requirement this plan must satisfy]

## Scope Boundaries

- [Explicit non-goal or exclusion]

## Context

### Relevant Code and Patterns

- [Existing file, class, pattern to follow]

### Constraints from Existing Plans

- [Any constraints from other active plans]

## Key Technical Decisions

- [Decision]: [Rationale] (see decision log #N)

## Open Questions

### Resolved During Planning

- [Question]: [Resolution]

### Deferred to Implementation

- [Question]: [Why deferred]

## File Structure

[Every file this plan creates or modifies, one line each — the changed-area map.]

- `path/to/file` — [responsibility / what changes here]

## Implementation Units

- [ ] **Unit 1: [Name]**

  **Goal:** [What this accomplishes]
  **Requirements:** [R1, R2]
  **Dependencies:** [None / Unit N / external]
  **Decision trace:** [Decision log #N, #M — WHAT-level only; HOW detail needs no decision]

  **Interfaces:**
  - Consumes: [exact signatures/types this unit takes from earlier units, or None]
  - Produces: [function names + param/return types later units rely on, or None]

  **Files:**
  - Create: `path/to/new_file` → [which symbol / what it does]
  - Modify: `path/to/existing_file` → [which symbol / what changes]
  - Test: `path/to/test_file` → [what it covers]

  **Approach:**
  - [Concrete control logic, branches, data flow, boundaries — multi-paragraph when warranted, not a hand-wave bullet]

  **Technical design:** *(when non-obvious — pseudo-code or diagram, directional guidance not implementation spec)*

  **Patterns to follow:**
  - [Existing code or convention]

  **Test scenarios (U rows):** [plan-authored, locked to this unit, against its REAL inputs/functions. Status ☐, ticked by wayne-work. Feature unit blank = incomplete; pure config/scaffolding → `none — <reason>`]
  - [Happy] [input → action → expected]  (U#)
  - [Edge] [input → action → expected]  (U#)
  - [Error] [input → action → expected]  (U#)
  - [Integration] [input → action → expected]  (U#)

  **E rows:** [carried e2e rows this unit advances e.g. `E1` (Status ⬜, run by wayne-verify), or `none — <reason>`. Carried verbatim, never authored here.]

  **Verification:**
  - [Outcome that holds when this unit is complete]

## Test Matrix

> Two layers, two authorships. **Layer 2 (E2E)** is carried **verbatim** from the `wayne-test-design` doc (`docs/test-matrix/...`); the plan never adds/drops/mutates it — flag e2e gaps back to wayne-test-design. Status mutated only by wayne-verify (`⬜ → ✅/❌`); see `_shared/e2e-contract.md` for the locked format. **Layer 1 (Unit/Integration)** is **authored & locked here** by wayne-plan (re-expressed from the test-design U-SEED against real units, gaps filled directly); Status mutated by wayne-work (`☐ → ☑`).

### Layer 1: Unit / Integration  *(authored & locked by wayne-plan)*

| # | Unit | Dimension | Case (input → action → expected) | Layer | Status |
|---|------|-----------|----------------------------------|-------|--------|
| U1 | [unit] | positive | [input → action → expected] | unit | ☐ |

### Layer 2: E2E Verification Contract  *(carried verbatim from wayne-test-design)*

| # | User path | Env: process | Env: data | Env: entrypoint | Observable (pass = ?) | Status |
|---|-----------|--------------|-----------|-----------------|----------------------|--------|
| E1 | [what the user does end to end] | [process/server to start] | [data it runs against] | [where the user enters] | [real user-visible outcome that proves it works] | ⬜ |

<!-- Where a reviewer-expected dimension is deliberately excluded, declare it: e.g. `E2E: none — <reason>` or `U-x concurrency: none — <reason>`. Structurally-absent dimensions are omitted entirely. -->>

## Dead Code / Legacy Cleanup

- [Dead] `path/to/old_file` — action: delete / decision log #N
- [Legacy] `path/to/legacy_file` — action: deprecate by YYYY-MM-DD / decision log #N
- [Shared] `path/to/shared_file` — action: keep, used by both old and new

## System-Wide Impact

- **Interaction graph:** [What callbacks, middleware, observers affected]
- **Error propagation:** [How failures travel across layers]
- **State lifecycle risks:** [Partial-write, cache, duplicate concerns]
- **Unchanged invariants:** [Existing APIs/behaviors explicitly not changed]

## Risks & Dependencies

| Risk | Mitigation |
|------|------------|
| [Risk] | [How addressed] |

## Sources & References

- **Origin spec:** [path](path)
- **Decision log:** [path](path)
- Related code: [path or symbol]
