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

## Implementation Units

- [ ] **Unit 1: [Name]**

  **Goal:** [What this accomplishes]
  **Requirements:** [R1, R2]
  **Dependencies:** [None / Unit N / external]
  **Decision trace:** [Decision log #N, #M]

  **Files:**
  - Create: `path/to/new_file`
  - Modify: `path/to/existing_file`
  - Test: `path/to/test_file`

  **Approach:**
  - [Key design or sequencing decision]

  **Patterns to follow:**
  - [Existing code or convention]

  **Test scenarios:**
  - Happy path: [input → action → expected outcome]
  - Edge case: [boundary → action → expected outcome]
  - Error path: [failure → action → expected outcome]

  **Verification:**
  - [Outcome that holds when this unit is complete]

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
