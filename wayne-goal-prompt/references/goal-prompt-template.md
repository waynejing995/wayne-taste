# Goal-prompt template — six-part guide

Use this skeleton when it makes the goal easier to execute. Preserve the required
information, but adapt headings or grouping when clearer. Delete the parenthetical
hints and emit one copy-paste block. Current correction is by-need.

---

Goal: (one line — the outcome, not a task list.)

Context:
- (framing fact: what this is — fork/rewrite/greenfield, which structure to keep.)
- (definition: what "parity"/"done"/"correct" means here, to kill ambiguity.)
- (red-line: Do not <X>. State each constraint as a "Do not" so it can't be missed.)
- (red-line: Do not claim complete until <the real proof> has happened.)

Current correction:   ← include ONLY when steering an in-flight attempt; else delete
- (the delta from the last attempt — what changed, what was wrong.)
- (concrete facts: exact config keys, paths, values the agent must use.)
- (secret hygiene: never print/copy secret values; materialize via an env-var
  name like ALFRED_X_HEADERS, pass only the env-var reference.)

Tasks:
1. (concrete step.)
   - (sub-step / constraint inlined AT this task, not pooled elsewhere.)
   - (the "do not" that governs THIS step.)
2. (concrete step.)
   - (...)

Verification required before completion:
- (exact command line — `uv run pytest path::test -q`, not "run the tests".)
- (exact second command for the other layer — bun/playwright/etc.)
- (a REAL e2e path driven through the actual entrypoint — name it; forbid the
  fake substitute, e.g. "do not replace the TUI drive with direct CLI calls".)
- (manual/command evidence: what the operator should see, concretely.)

Completion criteria:
- (testable bullet — each one checkable, each one mapping to a Verification cmd.)
- (testable bullet — state the observable evidence that decides it.)
- (the real-path criterion: the thing works through the actual surface, not a stub.)
- (the negative criterion: no secrets printed/committed, no fake substitute used.)
