---
name: wayne-verify
description: "Executes a carried E2E Verification Contract through the real process, data, entrypoint, and user path; captures fresh observable evidence; mutates only E2E Status; and gates shipping. Use for verify, e2e, run the feature, does it actually work, runtime verification, or /wayne-verify; never substitute unit tests or static review."
---

# Wayne Verify

Run the feature as its user runs it and decide the runtime gate from fresh evidence.

## Boundary and contract owner

Read `../_shared/pipeline-id-contract.md` and `../_shared/e2e-contract.md` completely. They own the required E2E information, explicit no-E2E rationale, and Status lifecycle. Use the exact authoritative `.wayne/runs/<topic>/test-matrix.md` path carried by the handoff or supplied by the user; never select or mutate the read-only snapshot inside a plan. Do not author or repair the matrix.

This skill alone may change the E2E `Status` cells (`⬜/✅/❌`). Never change a unit-integration status, another contract cell, or product code. Unit tests and static review have zero bearing on this gate.

## Flow

```mermaid
flowchart TB
    A["Locate and validate contract"]
    B{"Runnable contract row?"}
    X(["BLOCKED: return to test design"])
    K["Record legitimate skip"]
    C["Prepare declared environment"]
    D["Start and observe readiness"]
    E{"Process ready?"}
    F["Drive real user entrypoint"]
    G["Capture real observable"]
    H{"Observable occurred?"}
    P["Set fresh Status ✅"]
    N["Set fresh Status ❌"]
    T["Tear down and preserve evidence"]
    M{"More rows?"}
    Q{"Any ❌ or cleanup failure?"}
    W(["FAILED: return rows to wayne-work"])
    S(["PASSED: checkpoint handoff to wayne-ship"])

    A --> B
    B -->|"missing / invalid skip"| X
    B -->|"legitimate skip"| K
    B -->|"yes"| C
    K --> M
    C --> D
    D --> E
    E -->|"no"| N
    E -->|"yes"| F
    F --> G
    G --> H
    H -->|"yes"| P
    H -->|"no"| N
    P --> T
    N --> T
    T --> M
    M -->|"yes"| C
    M -->|"no"| Q
    Q -->|"yes"| W
    Q -->|"no"| S
```

## Process

### A. Locate and validate the contract

Select the carried matrix for this run and read its E2E layer plus relevant requirements. If no contract exists, stop without running or editing anything; route to `wayne-test-design`. Never invent verification.

Validate each `E2E: none — <reason>` against the actual requirement. Accept a skip only when no user-observable path exists. If it hides a real path, reject it and require test design to author a row; do not write or execute a replacement yourself.

A row whose kind or proof layer is missing, or whose declared layer sits below what its claim names, is `BLOCKED` and returns to `wayne-test-design`. Never choose a layer for a row: picking the convenient one is how a service call closes a row about a button.

### K. Record a legitimate skip

Record the approved requirement and why it has no user-observable path, without editing the contract or inventing a runtime command. Then continue through the row loop and final gate; a legitimate skip is neither `❌` nor `BLOCKED`.

### C. Prepare the declared environment

Run every E entry in its authored order, including incoming `✅` or `❌`: those statuses are historical, not evidence for this session. Create a run scratch directory and capture the pre-run contract. Use the exact host/worktree, process, data, and entrypoint named by the row; never substitute your cwd, another worktree, a mock, or a convenient environment.

### D. Start and observe readiness

Start the declared process against the declared data. Wait for its real readiness event—port, health event, log line, or DB signal—not blind sleeps. Preserve startup logs. If the process exits or cannot become ready, record fresh `❌`; do not skip it or drive a dependent entrypoint as proof.

### F. Drive the real user entrypoint

Perform the row's `User path` through its declared entrypoint exactly as a user would, at the row's declared proof layer: browser interaction for UI, real client requests for HTTP, or the real CLI command. A unit test, internal function, helper, mock, or direct API shortcut is not an E2E substitute, and a service call that produces the same effect is not evidence that the control produces it.

On a `goal-walk` row, walk every stop and check the surrounding surfaces the row names. Not arriving is `❌`, however correct each intermediate step looked.

### G. Capture the real observable

Capture the declared user-visible result in the scratch directory: rendered UI, response/artifact, or actual external/file/DB state. `200 OK`, no exception, and a true return value are transport signals, not proof. Compare the observed value with the contract literally and retain both expected and actual evidence.

A hang produces no state and no error, so nothing contradicts the assertion. Bound the drive with a timeout and log `request`, `response`, and `requestfailed` together: a probe listening only for responses reports "no request was made", which is a different bug and sends the next agent to the wrong place. Timeout expiry is `❌` with the in-flight request as its evidence. An optimistic UI clear is not the observable either — the box emptying looks exactly like a successful send.

### P/N. Mutate only fresh Status

Set `✅` only after the observable appears in this session. Set `❌` when startup, the user path, or the observable fails. Change only that E entry's Status; preserve the unit layer and every other contract fact unchanged, regardless of presentation.

### T. Tear down and preserve evidence

Stop the exact process after every row, including failure paths, and prove it no longer owns its port/process/resource. Preserve readiness, drive, observable, failure, and teardown evidence. Cleanup failure keeps the gate failed; never report ship-ready while the verification process remains live.

### Q. Gate and route

- Missing contract or invalid skip: `RUNTIME VERIFICATION: BLOCKED`; route to `wayne-test-design` without a fabricated row.
- Any `❌` or cleanup failure: `RUNTIME VERIFICATION: FAILED`; report expected vs actual evidence and return failing row IDs to `wayne-work`. No ship handoff.
- All rows freshly `✅` and legitimate skips confirmed: `RUNTIME VERIFICATION: PASSED`; append one `verified` entry to the topic's living spec frontmatter — `{ by: process:wayne-verify, at: <ISO 8601> }` — report evidence, then call `wayne-checkpoint` in handoff mode with `wayne-ship` as the next stage.

That entry is the only spec mutation this skill may make, and it is append-only: it records that the contract ran green, which survives the matrix. Never edit the spec's `## Verification` rows, and never add the entry on `BLOCKED` or `FAILED`.

Append by normalizing whatever is already there, never by overwriting it:

- no `verified` key: create a one-element list;
- a bare `{ by, at }` mapping: convert it to a list preserving that event, then append — OKF treats a bare mapping as a one-element list;
- a list: append.

Quote the timestamp so it stays a string:

```yaml
verified:
  - { by: process:wayne-verify, at: "2026-05-12T10:00:00Z" }
```

Losing a prior verification event destroys the trust tier it established — a human sign-off overwritten by a process entry silently downgrades the spec from human-reviewed to machine-confirmed.

`PASSED` authorizes only that return-only handoff. It never authorizes commit, push, PR creation, or invoking `wayne-ship`; stop after surfacing the packet.

Never turn inability to run, stale status, prior evidence, or provider/tool failure into a pass.
