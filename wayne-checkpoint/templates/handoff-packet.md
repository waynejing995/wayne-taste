---
title: {title}
status: handoff
branch: {branch}
timestamp: {ISO-8601}
pipeline_stage: {triage|brainstorm|plan|work|review|verify|ship}
pipeline_phase: {specific phase within the calling skill, e.g. "Wave 2 done"}
route: {caller route verdict | none for a linear stage}
snapshot: {primary repository-relative artifact}
next_agent: {one available wayne-* Skill slug}
trigger: manual
goal_included: {true|false}
decision_log: docs/decisions/{file}.md
plan: docs/plans/{file}.md
spec: docs/specs/{file}.md
test_matrix: docs/test-matrix/{file}.md
files_modified:
  - path/to/file1
  - path/to/file2
---

## Handoff: {current stage} → {next agent}

This is a return-only handoff packet (Mode A). It does NOT advance the pipeline.
The user must manually trigger the next step (say "下一步" / "继续" / "go").

### Snapshot

Current state at the moment of handoff (same fields a checkpoint captures).

- **Pipeline stage:** {current stage}
- **Route:** {caller route verdict | linear stage adjacency}
- **Primary snapshot:** `{snapshot path}`
- **Branch:** {branch}
- **Git status:** {clean | N files modified, M staged}
- **Decision log:** {N} decisions logged, status {in-progress/completed} — `{decision_log path}`
- **Plan:** {X}/{Y} implementation units done — `{plan path}`
- **Test Matrix:** authoritative E Status owner — `{test_matrix path}`

**Implementation Units (checkbox status copied from plan):**

{Same checkbox format as checkpoint-template.md / wayne-plan, so the next agent
reads it without re-parsing.}

- [x] **I1: {name}** — Status: DONE — spec ✅ quality ✅
- [x] **I2: {name}** — Status: DONE — spec ✅ quality ✅
- [ ] **I3: {name}** ← NEXT — Status: NOT STARTED
- [ ] **I4: {name}** — Status: BLOCKED BY I3

**Decision Log Snapshot (table copied from decision log):**

| ID | Question | Decision | Rationale | Source |
|---|----------|----------|-----------|--------|
| D1 | ... | ... | ... | user |
| D2 | ... | ... | ... | codebase |

### Next Agent

`{next_agent}` — the natural next step after {current stage}.

| Field | Value |
|-------|-------|
| Next agent | `{next_agent}` |
| Trigger | manual — user says "下一步" / "继续" / "go" |
| Auto-advance | NO (never) |

### Next Prompt

Self-contained prompt for `{next_agent}`. The next agent has NO prior context —
this prompt stands alone (names branch, paths, units in scope, definition of done).
Do not write "continue from before"; restate everything needed.

```
{Self-contained prompt text here. Example shape:}

You are running {next_agent} on branch `{branch}`.
Plan: `{plan path}`. Spec: `{spec path}`. Decision log: `{decision_log path}`.
Authoritative Test Matrix: `{test_matrix path}`. Never mutate the plan's E snapshot.
Scope: {units / files / area in scope}.
Already done: {what previous stages produced}.
Do: {concrete instruction for this stage}.
Acceptance criteria: {observable conditions that prove this stage is done}.
Out of scope: {explicit exclusions carried from the caller}.
```

### Goal (optional)

{Include ONLY when concrete success criteria are extractable. When present, the
next step may loop autonomously toward the goal. When absent, delete this section
and the next step follows its prompt/plan steps strictly. See CLAUDE.md
"Goal-Driven Execution".}

**Success criteria:**

| # | Criterion | Verify by |
|---|-----------|-----------|
| 1 | {concrete, checkable outcome} | {test / command / observation} |
| 2 | {concrete, checkable outcome} | {test / command / observation} |

Loop until all criteria verified.

### Notes

{Gotchas, blockers, open questions, dead ends carried into the next stage.}
