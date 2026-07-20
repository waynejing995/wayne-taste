# E2E Verification Contract — the runnable proof a feature actually works

A reusable contract format that pins down, at design time, how each user-observable
requirement will be **run the way a real user runs it** — concrete process, concrete
data, concrete entrypoint, concrete observable outcome. It is the single source of
truth (SSoT) for end-to-end verification: written once by `wayne-test-design` (which
`wayne-mind-explode` invokes at design time), carried unchanged by `wayne-plan`, executed
only by `wayne-verify`, and gated on by `wayne-ship`. No other skill redeclares its format
— they all link here.

It exists to stop the silent degradation where "the feature works" quietly collapses
into "the unit tests pass." Unit tests have **zero** bearing on this contract; the
contract answers *does the feature actually work in real use*.

---

## The Format (LOCKED)

A single markdown table. These columns, in this order, exactly:

| ID | User path | Env: process | Env: data | Env: entrypoint | Observable (pass = ?) | Status |
|---|-----------|--------------|-----------|-----------------|----------------------|--------|
| E1 | User opens dashboard, clicks a ticket, hits "Transition → Analyzed" | `uv run dashboard_server.py` on :8765 | real `wayne.db` | browser `/` | Jira ticket status actually changed to Analyzed (confirmed in Jira UI), and the row re-renders as Analyzed | ⬜ |

- **ID** — canonical `E<number>` from `_shared/pipeline-id-contract.md`.
- **User path** — what the user actually does, end to end. Not an internal call; the human-level journey.
- **Env: process / data / entrypoint** — the three fixed environment sub-columns (see below).
- **Observable (pass = ?)** — the real user-visible outcome that proves it works.
- **Status** — ⬜ / ✅ / ❌ (see lifecycle below). Starts ⬜.

---

## Why Environment Is Three Fixed Sub-Columns

Environment is **not** free text. Free text degrades into vague hand-waving — "test in
the test env", "run it locally" — which e2e can then be silently mocked around. Forcing
three concrete, reproducible sub-columns makes the agent commit, at design time, to an
environment that can actually be stood up and driven:

| Sub-column | Answers | Good | Bad (rejected) |
|---|---|---|---|
| Env: process | What process/server to start | `uv run dashboard_server.py` on :8765 | "the app" |
| Env: data | What data it runs against | real `wayne.db` | "some data" |
| Env: entrypoint | Where the user enters | browser `/`, or `cli sync-now` | "the UI" |

The concrete environment is the anchor. If you can't fill all three with something
runnable, you don't yet have an e2e path — say so (see the skip rule).

---

## Observable Must Be a Real Outcome

The Observable column is a **user-visible** result, never a transport-level proxy.

- Good: "Jira ticket status actually changed to Analyzed", "email disappears from the
  inbox list after dismiss", "report PDF downloads and opens".
- Bad: "API returned 200", "no exception thrown", "function returned True".

A 200 OK proves the wire moved, not that the feature worked. Write what you must **see**.

---

## Status Lifecycle

| Symbol | Meaning | Who may set it |
|---|---|---|
| ⬜ | Unverified — written, not yet run | `wayne-test-design` (initial state) |
| ✅ | Ran along the user path, observed the outcome | `wayne-verify` only |
| ❌ | Ran, the observable did not appear | `wayne-verify` only |

**Only `wayne-verify` mutates Status.** No other skill — not plan, not work, not
code-review, not ship — touches this column. Passing unit tests never flips ⬜.

---

## Trigger Rule — Mandatory, with Forced Declaration on Skip

**Mandatory.** Every requirement that has a user-observable path MUST get a contract
row. If a user can do it and see a result, it has a row.

**Skip — but declare.** Requirements with NO user-observable path — pure refactor,
pure algorithm, pure internal config — do NOT get table rows. Instead they get one
explicit line beneath the table:

```
E2E: none — <reason, e.g. "internal refactor of db.py, no behavior change">
```

Never silently omit. Absence of a row must be a deliberate, written statement, so a
reviewer can challenge "is that really un-observable?" A missing-and-unexplained path
is a Fail-Loud violation.

**When unsure, write the row.** The cost of a spurious row is one extra check; the cost
of a missing row is shipping un-verified behavior. Bias toward the row.

---

## Who Writes vs Who Executes

| Skill | Role on the contract |
|---|---|
| `wayne-test-design` | **WRITES** the table (as the e2e layer of the test matrix) at design time; all Status = ⬜ |
| `wayne-mind-explode` | **INVOKES** `wayne-test-design` at the end of design; does not author the table itself |
| `wayne-plan` | **CARRIES** it unchanged; each implementation unit notes which row #s it serves |
| `wayne-work` | builds the units; does **not** touch the table |
| `wayne-code-review` | **does NOT touch it** — code-review is pure-static |
| `wayne-verify` | **EXECUTES** it: starts the process, loads the data, drives the entrypoint along the user path, checks the observable, flips ⬜ → ✅ / ❌ |
| `wayne-ship` | **GATES** on it: cannot ship unless the whole table is ✅ — no remaining ⬜, no ❌ |

Design defines the proof. Runtime runs the proof. Ship refuses to proceed without it.
