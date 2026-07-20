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

### Artifact References

| Artifact | Path | Owner | SHA-256 | Observed state |
|---|---|---|---|---|
| Decision log | `{decision_log path}` | `wayne-mind-explode` | `{sha256}` | {state at checkpoint time} |
| Plan | `{plan path}` | `wayne-plan` / U Status by `wayne-work` | `{sha256}` | {state at checkpoint time} |
| Spec | `{spec path}` | product-design stage | `{sha256}` | {state at checkpoint time} |
| Test Matrix | `{test_matrix path}` | `wayne-test-design` / E Status by `wayne-verify` | `{sha256}` | {state at checkpoint time} |

### Decision Progress

- Source: `{decision_log path}` at `{sha256}`.
- Observed at checkpoint time: {N decisions; in-progress/design-approved}.
- This is a derived historical summary; resume re-reads the source owner.

### Implementation Progress

| Unit | Observed state | Source |
|---|---|---|
| I1 | {state at checkpoint time} | `{plan path}` at `{sha256}` |
| I2 | {state at checkpoint time} | `{plan path}` at `{sha256}` |

This table is orientation only. `wayne-work` re-reads the authoritative plan and
current U Status; it never executes from this checkpoint summary.

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
