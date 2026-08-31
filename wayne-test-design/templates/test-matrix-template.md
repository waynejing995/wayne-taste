---
title: "[Feature] Test Matrix"
type: test-matrix
status: active
scope: run # working state; absorbed into the spec at ship, then deleted
date: YYYY-MM-DD
origin: docs/specs/<topic>.md
decisions: <the run-scoped decision log for this run>
---

# [Feature] Test Matrix

<!-- This is a readable starting layout. Preserve the information and ownership
     contract; adapt headings or grouping when clearer. -->

## Overview

[What this matrix covers — 1-2 sentences. Name the feature and its source spec/plan.]

Coverage summary: [R1✓ R2✓ R3✓ | seed: S1-Sn | e2e: E1-En]

## Dimensions Considered

The dimension menu walked for this feature. Dimensions structurally absent from the behavior are omitted entirely (not listed as `none`). Only reviewer-surprising deliberate gaps appear as `none — reason` under their rule.

[One line each, e.g.:

- positive, negative, invalid, persistence — apply broadly
- concurrency — omitted: single-writer admin action, no shared mutable row
- boundary — omitted: no numeric/size limits in this feature]

## Environment

Confirmed item by item with the user in node Q. Repository files were proposed defaults only. Every E `Given` restates the relevant facts literally instead of pointing here. **Variable names only — no secret values in this file.**

| # | Item | Value |
| --- | --- | --- |
| 1 | Working directory | [/srv/app, main worktree — a copy is NOT acceptable because ...] |
| 2 | Install / build | [`uv sync`] |
| 3 | Env file | [.env.local, copied from .env.example; defines WAYNE_DB_PATH, OPENAI_API_KEY] |
| 4 | How it is loaded | [`uv run --env-file .env.local ...`] |
| 5 | Precondition data | [`uv run scripts/reset_demo.py` seeds the real ./wayne.db] |
| 6 | Start + readiness | [`uv run dashboard_server.py`, 127.0.0.1:8765; ready when the log prints "Uvicorn running on ..."] |
| 7 | Entrypoint | [browser http://127.0.0.1:8765/ , or `wayne sync-now`] |
| 8 | Teardown | [stop the server; `lsof -i :8765` returns empty] |

Confirmed by: [user, on <date>]

[Any unconfirmed item → this matrix is BLOCKED and hands nothing to `wayne-plan`:]

BLOCKED: [which items are unconfirmed, and who must answer them]

---

## Layer 1: Unit / Integration

### U-SEED (wayne-plan re-authors + locks)

Developer / `wayne-work` ticks `☐ → ☑` when the test passes. These do **not** gate `wayne-verify` or `wayne-ship`'s e2e check. Not BDD: these seeds are cut along implementation seams and may name symbols, fields, and exceptions directly.

`unit` = isolated, mocks OK. `integration` = crosses a real seam (real DB / real service), mocks discouraged.

| ID | Rule | Dimension | Case | Layer | Status |
| --- | --- | --- | --- | --- | --- |
| S1 | R1 | positive | [concrete precondition, action, and observable result] | unit | ☐ |
| S2 | R1 | invalid | [invalid boundary and observable rejection behavior] | unit | ☐ |
| S3 | R2 | persistence | [write/reload boundary and observable persisted result] | integration | ☐ |

[If no U-SEED row is sound, state that explicitly with a reviewable reason.]

Declared gaps (reviewer-surprising dimensions deliberately excluded):

- [R-name] [dimension]: none — [reason a reviewer can challenge]

---

## Layer 2: E2E Verification Contract

This layer **is** the E2E Verification Contract. Its information and ownership come from `../../_shared/e2e-contract.md`; the blocks below are the recommended view, not a grammar. All Status start `⬜`. **Only `wayne-verify` flips `⬜ → ✅ / ❌`.** A passing unit suite never touches this layer.

Every block is self-contained: no "same as", no shared Background, no reference to another scenario. `Teardown:` is a plain line after the block, never a `Then`.

### E2E Proof-Axis Audit

- Functional scenarios (provider-specific): [provider → IDs]
- Attestation scenarios (provider-specific): [provider → IDs → native runtime evidence]
- Aggregate scenarios: [IDs → cross-provider behavior that requires aggregation]
- Resilience/cleanup scenarios (provider-specific): [provider → IDs]
- Explicit weaker/unverified scenarios: [IDs → supported public mode → `POLICY UNVERIFIED` in the `Then`]
- Capability conflicts requiring scope resolution: [requirement → missing native proof, or "none"]

### UI Control Graph

[Omit this section entirely when the behavior has no user interface.]

| Node (reachable state) | Visible controls | Edge scenarios |
| --- | --- | --- |
| [overview] | [New run, Open run, Refresh] | [E2, E3, E4] |
| [start dialog step 1] | [repo checkbox, Next (disabled until ticked)] | [E5, E6] |

Every control listed appears as exactly one `edge` scenario; a control with no scenario is a hole in the matrix. This graph enumerates what EXISTS — it cannot show a control the product needs and nobody wrote, which is what the `goal-walk` scenarios are for.

User goals walked end to end (one `goal-walk` each, and these gate the change):

- [an engineer turns a conversation into a spec] → [E1]

### R3 — [the rule these scenarios prove, quoted from the spec]

**E1** · kind: `goal-walk` · axis: functional · proof layer: `browser` · source requirements: [R3, R7] · Status: ⬜

```gherkin
Given [the working directory, and that the install/build command has succeeded there]
  And [the env file, where it came from, and the variable NAMES it defines]
  And [how the process loads that file]
  And [the seed/reset command that reached the precondition state, and the data it left]
  And [the process started, and the readiness signal proving it is up]
  And [the precondition that must NOT already exist]
When  [the user opens the entrypoint]
  And [each action, one per line, in order, named as its user names it]
  And [waits up to <bound> for the terminal state]
Then  [the goal's terminal state — never an optimistic intermediate]
  And [an independent second assertion, e.g. the artifact on disk]
  And [the surrounding surface this walk passed: list row, nav, status line]
```

Teardown: [the stop command, and the check proving the port/process/resource is free]

**E2** · kind: `edge` · axis: functional · proof layer: `browser` · Status: ⬜

```gherkin
Given [the process, data, and readiness, restated literally]
  And [the node the user is on]
When  [exactly one control action]
Then  [the state change: URL, dialog, new list row]
```

Teardown: [the stop command and its free-resource check]

**E3** · kind: `path` · axis: resilience · proof layer: `cli` · Status: ⬜

```gherkin
Given [the prerequisite / degraded / cleanup condition, set up literally]
When  [the action along that supporting journey]
Then  [the native evidence for this scenario's axis]
```

Teardown: [the stop command and its free-resource check]

[If a requirement has no user-observable path, write the explicit line instead of a scenario:] E2E: none — [reason, e.g. "internal repository refactor, no behavior change"]

---

## Provenance

- Absorbed e2e contract draft from spec: [yes — now superseded by this matrix / no draft existed]
- KB lessons matched: [list with paths, or "none matched"]
- Regression rows (if from a bug report): [IDs, or "n/a"]
