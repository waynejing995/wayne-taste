---
title: {title}
status: in-progress
branch: {branch}
timestamp: {ISO-8601}
pipeline_stage: {brainstorm|plan|work|review|verify|ship|compound}
pipeline_phase: {specific phase within skill, e.g. "Phase 3: Grill" or "Wave 2"}
decision_log: docs/decisions/{file}.md
plan: docs/plans/{file}.md
spec: docs/specs/{file}.md
test_matrix: docs/test-matrix/{file}.md
files_modified:
  - path/to/file1
  - path/to/file2
---

## Working on: {title}

### Summary

{1-3 sentences: goal + progress}

### Pipeline State

- **Stage:** {wayne-mind-explode / wayne-plan / wayne-work / wayne-code-review / wayne-verify / wayne-ship / wayne-compound}
- **Phase:** {specific phase, e.g. "Phase 3: Grill — Q7 asked, 4 branches remaining"}
- **Last action:** {what was the last thing completed}
- **Next action:** {what should happen next when resumed}

### Decision Log Snapshot

{Decisions logged so far — copy the table from the decision log}

| ID | Question | Decision | Rationale | Source |
|---|----------|----------|-----------|--------|
| D1 | ... | ... | ... | user |
| D2 | ... | ... | ... | codebase |

Total: {N} decisions logged. Status: {in-progress/completed}

### Authoritative Test Matrix

`{test_matrix path}` — E Status SSoT. Any E block in a plan is a read-only snapshot.

### Implementation Units (from plan)

{Copy the plan's implementation units with their checkbox state — this is the
format wayne-work reads, so resume can feed directly back into it}

- [x] **I1: {name}**
  - Goal: {goal}
  - Files: {files}
  - Verification: {verification}
  - Status: DONE — spec ✅ quality ✅

- [x] **I2: {name}**
  - Goal: {goal}
  - Files: {files}
  - Verification: {verification}
  - Status: DONE — spec ✅ quality ✅

- [ ] **I3: {name}** ← NEXT
  - Goal: {goal}
  - Files: {files}
  - Approach: {approach}
  - Test scenarios: {scenarios}
  - Verification: {verification}
  - Status: NOT STARTED
  - Execution note: {if any}

- [ ] **I4: {name}**
  - Goal: {goal}
  - Files: {files}
  - Status: BLOCKED BY I3

### Wave Progress (if parallel execution)

{If wayne-work used waves, capture which waves are done}

| Wave | Tasks | Status |
|------|-------|--------|
| Wave 1 | I1, I2 | DONE |
| Wave 2 | I3, I4 | IN PROGRESS — I3 next |
| Wave 3 | I5 | PENDING |

### Per-Task Review Status

{Track which tasks passed spec compliance + code quality}

| Unit | Spec | Quality | Notes |
|------|------|---------|-------|
| I1 | ✅ | ✅ | — |
| I2 | ✅ | ✅ | — |
| I3 | — | — | not started |

### Remaining Work

{Priority-ordered next steps — what wayne-work should do when resumed}

1. {Next concrete action}
2. {Following action}
3. {After that}

### Notes

{Gotchas, blockers, open questions, dead ends, things tried that didn't work}

### Deferred Decisions

{Any decisions from wayne-mind-explode that were deferred to implementation
and haven't been resolved yet}

- [ ] {deferred question 1}
- [ ] {deferred question 2}
