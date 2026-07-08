# Symptom Playbooks

Phase 2 sets the `signals{}` flags; this file is the per-symptom deep-dive they
route into. Each playbook = the identifying signal, what to grep/gather first, the
class-specific hypotheses to seed the matrix with, and the backward-trace target.
Run the ONE matching playbook — or more than one if signals overlap (a hang that
also left a stack trace runs both). If NO signal matches, do not guess a playbook;
gather more data (Phase 1) or mark the cause axis `unknown`.

Dispatch the gather step to a subagent when the log is heavy — take back only the
seeded matrix rows and the identifying citation, never the raw log.

---

## crash / abort   (signal: stack_trace)

- **Identify:** stack trace, non-zero exit, SIGSEGV / panic / uncaught exception.
- **Gather first:** the FIRST error, verbatim, with `file:line` — not the cascade after it. `rg -n "ERROR|EXCEPTION|panic|SIGSEGV|Traceback|Call Trace" <log> | head`.
- **Backward-trace:** from the crash frame, walk UP the call chain to where the bad value / null / bad pointer originated. Fix-point is the origin, not the crash site.
- **Seed hypotheses:** null/None at a specific frame · bad input crossing a boundary · unhandled edge case · contract violation between caller and callee.
- **Fail-Loud check:** is the crash actually a swallowed error re-surfacing later? Look for a `try/except`/`catch` upstream that dropped the real signal.

## hang / deadlock   (signal: deadlock_hang)

- **Identify:** no progress, timeout, process blocked; no crash, no output growth.
- **Gather first:** a thread/stack dump AT the hang (SIGQUIT / `py-spy dump` / `jstack` / core). Without it you are guessing — get the dump.
- **Backward-trace:** which two resources form the cycle? Map who holds what and who waits on what.
- **Seed hypotheses:** lock-ordering cycle · await on a future that never resolves · blocking IO with no timeout · unbounded queue / backpressure stall.
- **Note:** a fixed-duration `sleep` is not a repro of a hang. Reproduce the blocked *condition*, not a wait time.

## wrong-output   (signal: none specific — runs clean, result mismatches)

- **Gather first:** the exact expected vs actual, minimal input that shows the divergence. Shrink the input until it's the smallest failing case.
- **Backward-trace:** binary-search the pipeline — find the first stage whose output is already wrong, then dig only into that stage.
- **Seed hypotheses:** off-by-one / boundary · wrong operator or comparison · stale cache / wrong SSoT read · locale/encoding/rounding · a recent logic change (check `git log` on that stage).
- **Bisect:** if it worked before, `git bisect` (see below) localizes the introducing commit — that is a well-scoped candidate to route to a loop.

## perf-regression   (signal: perf_delta)

- **Identify:** correct output, slower than a baseline metric. You MUST have the baseline number — "feels slow" is not triage.
- **Gather first:** profile or trace BEFORE forming hypotheses. Never optimize blind. Get a flame graph / timing breakdown / the regressed metric vs baseline.
- **Backward-trace:** which call / query / allocation grew? Compare the profile against the last-good profile if you have one.
- **Seed hypotheses:** N+1 or added round-trips · lost index / query-plan change · new allocation in a hot path · added sync/IO wait · data-size growth crossing a threshold.
- **Bisect on the metric:** `git bisect run` with a script that exits non-zero when the metric exceeds threshold auto-localizes the regressing commit.

## flaky   (signal: flaky_pattern)

- **Identify:** non-deterministic pass/fail with NO code change. First-class category — do not "just re-run."
- **Gather first:** run N times, record the pass/fail ratio; capture logs from BOTH a pass and a fail and diff them.
- **Seed hypotheses in priority order** (empirically ~77% of flakiness is the top three):
  1. **async-wait** — waiting a fixed time instead of for the real condition (the single most common cause). Look for `sleep`, polling with a short timeout.
  2. **concurrency** — race / unsynchronized shared state / atomicity violation.
  3. **test-order dependency** — passes alone, fails in suite (or vice versa). Isolate by running the single test alone; if it then passes, an earlier test polluted shared state.
  4. remainder: resource leak, unordered collection assumption, network/IO, time/randomness, floating-point.
- **Backward-trace (order-dependency):** run tests one at a time in suite order; the first run that makes the polluting state appear is the culprit (linear isolation scan).
- **Fix-shape note (for the route, not for here):** replace fixed waits with condition-based waiting; that's the eventual fix, routed out — triage only names the cause.

## config-env   (signal: env_skew)

- **Identify:** fails in ONE environment only (CI but not local, prod but not staging). Same code, different result.
- **Gather first:** diff the environments — env vars, versions, OS, locale, filesystem, credentials, resource limits. `env`, lockfiles, image tags.
- **Backward-trace:** which single environmental difference, removed, makes it pass? Change one at a time.
- **Seed hypotheses:** missing / different env var · dependency version skew · missing runtime / library · resource limit (memory/fd/disk) · permission / credential gap · path / locale / timezone assumption.
- **Fail-Loud check:** a silent fallback (default value on missing config) often IS the bug — it masks the skew until the Nth action. Name the fallback.

---

## git bisect — the autonomous localizer (for wrong-output / perf-regression / crash that worked before)

When the failure is a regression from a known-good state, bisection localizes the
introducing commit by binary search — and it automates:

```bash
git bisect start <bad-rev> <good-rev>
git bisect run <script>     # script exit 0 = good, 1-127 = bad, 125 = skip
git bisect reset
```

The `<script>` is your repro reduced to an exit code. The result — a single
first-bad commit — is a tightly-scoped candidate to hand to an iteration loop or
fix directly. Localization is NOT the fix; it's the last mile of triage that makes
the route obvious.
