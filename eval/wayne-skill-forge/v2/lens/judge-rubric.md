# Judge-rubric: dependency-upgrade-risk-lens

This document links each test case to the specific intent clauses it exercises. All intent clauses are quoted verbatim from intent.md. A blind judge validates that each case's expected verdict follows from the intent's judgment principles alone.

## Risk Classes (from intent.md:36-38, verbatim)

- **ACCEPTABLE**: Nothing the application uses is removed, changed in a breaking way, or requires new configuration. All used APIs remain backward-compatible.
- **ACCEPTABLE-WITH-PRECAUTIONS**: An application-used code path breaks, AND at least one of these holds: (a) an existing low-cost workaround is already deployed in production; (b) a low-cost (<8 hours), feasible code or configuration fix is identified; or (c) a tolerated exception applies (security fix unblocks it, critical capability unlocked, or known pain point resolved). A precaution must state the required step or validation.
- **UNACCEPTABLE**: An application-used code path breaks, and none of (a)-(c) holds.

## Case 1: straightforward-safe-upgrade

**Expected verdict:** ACCEPTABLE

**Which risk-class criterion applies:** None break; uses only unchanged APIs (intent.md:36).

---

## Case 2: breaking-change-workaround-exists

**Expected verdict:** ACCEPTABLE-WITH-PRECAUTIONS

**Which risk-class criterion applies:** Criterion (a): existing low-cost workaround already deployed in production, with 47 activations in the last 3 months (§3, [E3], [E4]).

---

## Case 3: breaking-change-critical-path

**Expected verdict:** UNACCEPTABLE

**Which risk-class criterion applies:** None of (a)-(c) hold: no deployed workaround, no feasible fix (SSL/SCRAM rollout 3 weeks, error-handler rewrite 2 weeks per §4), no exception.

---

## Case 4: unlock-security-fix

**Expected verdict:** ACCEPTABLE-WITH-PRECAUTIONS

**Which risk-class criterion applies:** Criterion (c): tolerated exception — security fix unblocks upgrade ([E1], §5.1). Migration cost exceeds 8 hours ([E3]), so (b) does not apply alone.

---

## Case 5: mixed-breaking-and-capability

**Expected verdict:** ACCEPTABLE-WITH-PRECAUTIONS

**Which risk-class criterion applies:** Criterion (b): low-cost feasible code fix identified (ReactDOM.render → createRoot, 3 lines per [E4]). Criterion (c) does not apply: batching is not critical capability, and the known pain point (DASH-4521) is not fixed by the upgrade (separate memoization work required per [E3], [E6]).

---

## Case 6: partial-decline-mixed-scope

**Expected verdict:** ACCEPTABLE (in-scope Payments service) + one decline sentence declining Part B

**Which risk-class criterion applies:** ACCEPTABLE: Payments service uses only _.pick and _.omit, which are unchanged (§5.1). Part B asks whether other teams should upgrade; this is outside the scope (intent.md:16 — "Decline when the user requests you to decide for other teams' applications").

---

## Case 7: decline-no-context

**Expected verdict:** DECLINE

**Trigger boundary (intent.md:14-15):** "Decline when the request is purely technical... or when it lacks application context."

---

## Case 8: decline-holistic-monorepo

**Expected verdict:** DECLINE

**Trigger boundary (intent.md:16-17):** "Decline ... when you are asked to evaluate dependency compatibility in a monorepo holistically."
