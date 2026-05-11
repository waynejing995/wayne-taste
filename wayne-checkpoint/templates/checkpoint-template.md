---
title: {title}
status: in-progress
branch: {branch}
timestamp: {ISO-8601}
pipeline_stage: {brainstorm|plan|work|review|ship|compound}
pipeline_phase: {specific phase within skill, e.g. "Phase 3: Grill" or "Wave 2"}
decision_log: docs/decisions/{file}.md
plan: docs/plans/{file}.md
spec: docs/specs/{file}.md
files_modified:
  - path/to/file1
  - path/to/file2
---

## Working on: {title}

### Summary

{1-3 sentences: goal + progress}

### Pipeline State

- **Stage:** {wayne-mind-explode / wayne-plan / wayne-work / wayne-code-review / wayne-ship / wayne-compound}
- **Phase:** {specific phase, e.g. "Phase 3: Grill — Q7 asked, 4 branches remaining"}
- **Last action:** {what was the last thing completed}
- **Next action:** {what should happen next when resumed}

### Decision Log Snapshot

{Decisions logged so far — copy the table from the decision log}

| # | Question | Decision | Rationale | Source |
|---|----------|----------|-----------|--------|
| 1 | ... | ... | ... | user |
| 2 | ... | ... | ... | codebase |

Total: {N} decisions logged. Status: {in-progress/completed}

### Implementation Units (from plan)

{Copy the plan's implementation units with their checkbox state — this is the
format wayne-work reads, so resume can feed directly back into it}

- [x] **Unit 1: {name}**
  - Goal: {goal}
  - Files: {files}
  - Verification: {verification}
  - Status: DONE — spec ✅ quality ✅

- [x] **Unit 2: {name}**
  - Goal: {goal}
  - Files: {files}
  - Verification: {verification}
  - Status: DONE — spec ✅ quality ✅

- [ ] **Unit 3: {name}** ← NEXT
  - Goal: {goal}
  - Files: {files}
  - Approach: {approach}
  - Test scenarios: {scenarios}
  - Verification: {verification}
  - Status: NOT STARTED
  - Execution note: {if any}

- [ ] **Unit 4: {name}**
  - Goal: {goal}
  - Files: {files}
  - Status: BLOCKED BY Unit 3

### Wave Progress (if parallel execution)

{If wayne-work used waves, capture which waves are done}

| Wave | Tasks | Status |
|------|-------|--------|
| Wave 1 | Unit 1, Unit 2 | DONE |
| Wave 2 | Unit 3, Unit 4 | IN PROGRESS — Unit 3 next |
| Wave 3 | Unit 5 | PENDING |

### Per-Task Review Status

{Track which tasks passed spec compliance + code quality}

| Unit | Spec | Quality | Notes |
|------|------|---------|-------|
| Unit 1 | ✅ | ✅ | — |
| Unit 2 | ✅ | ✅ | — |
| Unit 3 | — | — | not started |

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
