---
title: <Plan title>
type: <feat|fix|refactor>
status: active
date: YYYY-MM-DD
origin: <repo-relative source path or none — converged direct request>
decisions: <repo-relative decision-log path or none — no decision log exists>
---

# <Plan title>

## Overview

<What changes and why, in two or three sentences.>

## Problem Frame

<The approved user or business problem and its source.>

## Requirements Trace

| Requirement | Owning units |
|---|---|
| R1 | I1 |

## Scope Boundaries

- <Explicit inclusion or exclusion.>

## Context

### Relevant Code and Patterns

- `path/to/file::symbol` — <current behavior or pattern.>

### Constraints from Existing Plans

- <Active-plan constraint, or `none — no active plan constrains this work`.>

### Applicable Lessons

- <Project or Wayne lesson and concrete mitigation, or exact sentinel with reason.>

## Key Technical Decisions

- D1 — <Decision and rationale carried from the source.>

## Open Questions

### Resolved During Planning

- <Question — resolution and evidence.>

### Deferred to Implementation

- <Execution-time question — why it does not change approved behavior.>

## File Structure

- `path/to/file` — <responsibility and planned change.>

## Implementation Units

### Unit I1 — <Dependency-ordered unit name>

#### Goal

<One closed outcome.>

#### Requirements

- R1

#### Dependencies

none — first unit

#### Consumes

- `path/to/existing.py::ExistingSymbol` from repository — <role>

#### Produces

- `path/to/new.py::new_symbol` — <input type → output type and role>

#### Files

- Create `path/to/new.py::new_symbol` — <specific work>
- Modify `path/to/existing.py::ExistingSymbol` — <specific work>
- Create `tests/test_new.py::test_new_symbol` — <specific coverage>

#### Approach

- <Concrete inputs, branches, data flow, failure behavior, and boundaries.>

#### Technical design

none — control flow is fully specified by the approach

#### Patterns

- `path/to/existing.py::ExistingSymbol` — <pattern to preserve>

#### Test scenarios

- U1 — <what the scenario proves>

#### E rows

- E1 — <part of the user path this unit advances>

#### Verification

- <Observable unit-completion evidence.>

#### Decision trace

- D1 — <WHAT-level scope carried by this unit>

## Test Matrix

<!-- Replace this comment with the complete source E table or source E2E-none line, byte-for-byte. -->

| ID | Owner | Seed | Surface | Scenario | Status |
|---|---|---|---|---|---|
| U1 | I1 | <exact source seed identifier> | path/to/new.py::new_symbol | concrete input → action → expected result | ☐ |

### Dropped Seeds

| Seed | Reason |
|---|---|

## Dead Code / Legacy Cleanup

- <Dead, legacy, or shared `path::symbol`; caller evidence; approved action.>

## System-Wide Impact

- **Interaction graph:** <Affected callbacks, middleware, events, or consumers.>
- **Error propagation:** <How failures cross boundaries.>
- **State lifecycle:** <Partial-write, cache, retry, or duplicate risks.>
- **Unchanged invariants:** <Behavior that remains unchanged.>

## Risks & Dependencies

| Risk or dependency | Mitigation or owner |
|---|---|
| <Concrete risk> | <Concrete mitigation> |

## Sources & References

- **Origin:** `docs/specs/YYYY-MM-DD-topic-design.md`
- **Decision log:** `docs/decisions/YYYY-MM-DD-topic-decisions.md`
- **Test matrix:** `docs/test-matrix/YYYY-MM-DD-topic.md`
- **Repository evidence:** `path/to/file::symbol`
