# Case 2 — held-out evidence

Neutral phrasing: the material's conditionality is discoverable from the content, not announced.

Author a skill that audits **resource lifecycle** in an unfamiliar async Python service: does every acquired resource have an owner that releases it, and does teardown actually reach quiescence.

## Trigger phrases

Should trigger: "audit resource lifecycle", "are we leaking tasks", "check teardown", "does shutdown actually stop things", "查一下资源泄漏".
Should not trigger: diagnosing one specific production incident; reviewing a diff the user just wrote.

## Local facts the model cannot infer

- `contextlib.AsyncExitStack` unwinds registered callbacks in reverse registration order; `pop_all()` transfers the undo list to a new stack without invoking anything, which is the transactional-commit primitive.
- An AnyIO/asyncio task group `__aexit__` **waits** for children on a normal exit and only cancels them when the body raises. A long-lived background task therefore hangs teardown unless a cancel is registered to run *before* the group exits.
- Because an exit stack unwinds in reverse, the cancel callback must be pushed **after** entering the task group. Reversed order does not raise; it deadlocks.
- Process-external resources — containers, VMs, remote sessions — survive SIGKILL, so they need a reconciliation sweep in addition to lifetime binding. A periodic reaper for those is correct design, not a missing destructor.
- Module-global singletons and `app.state` attributes can be two handles to one resource. Two handles with one close path is a dual-addressing/SSoT risk, not two lifetimes; only claim the stronger defect when two close paths exist.

## Baseline failures the skill must correct

1. Recommending `AsyncExitStack` as a blanket fix for leaked background tasks, without the cancel-before-await ordering — produces a hang.
2. Calling a periodic reaper a compensation for missing lifetime binding, when the resource is process-external.
3. Reporting "two handles" as "two lifetimes" without checking how many close paths exist.
4. Counting occurrences from truncated command output and reporting the wrong number.

## Resource kinds in scope

asyncio tasks and task groups; HTTP clients (`httpx`/`aiohttp`); subprocesses and PTY file descriptors; database pools; module-level registries and caches; process-external resources such as containers and VMs. Each has its own detection command, correct-fix shape, and false-positive pattern.

## Output

A findings list. Each finding: resource kind, `path:line`, whether an owner exists, whether release is reached on normal exit and on crash, the minimal fix, and a confidence tag when the claim is inferred rather than observed.
