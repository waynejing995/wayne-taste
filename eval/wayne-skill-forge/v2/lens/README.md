# V2 Lens Evaluation Suite: dependency-upgrade-risk-lens

This is a harder evaluation suite for the skill forge that tests a dependency upgrade risk judgment lens. The v1 cases were too easy; v2 introduces real nuance where the same surface signal leads to different verdicts based on qualifying facts.

## Risk Classes (From intent.md:36-38, Verbatim)

- **ACCEPTABLE**: Nothing the application uses is removed, changed in a breaking way, or requires new configuration. All used APIs remain backward-compatible.
- **ACCEPTABLE-WITH-PRECAUTIONS**: An application-used code path breaks, AND at least one of these holds: (a) an existing low-cost workaround is already deployed in production; (b) a low-cost (<8 hours), feasible code or configuration fix is identified; or (c) a tolerated exception applies (security fix unblocks it, critical capability unlocked, or known pain point resolved). A precaution must state the required step or validation.
- **UNACCEPTABLE**: An application-used code path breaks, and none of (a)-(c) holds.

## Eight Cases with Single Expected Verdicts and Deciding Criteria

1. **straightforward-safe-upgrade** → ACCEPTABLE: No breaking changes; all used APIs remain backward-compatible.
2. **breaking-change-workaround-exists** → ACCEPTABLE-WITH-PRECAUTIONS: Criterion (a) applies — existing low-cost workaround proven in production (47 activations).
3. **breaking-change-critical-path** → UNACCEPTABLE: No (a)/(b)/(c); feasible fix costs 3+ weeks; no exception.
4. **unlock-security-fix** → ACCEPTABLE-WITH-PRECAUTIONS: Criterion (c) applies — security fix (CVE-2024-FAKE1). Migration cost >8h so (b) alone insufficient.
5. **mixed-breaking-and-capability** → ACCEPTABLE-WITH-PRECAUTIONS: Criterion (b) applies — ReactDOM.render fix is 3 lines (<8h, feasible). Batching is not critical capability; known pain point (DASH-4521) is not fixed by upgrade.
6. **partial-decline-mixed-scope** → ACCEPTABLE (in-scope) + decline: Payments service uses only unchanged APIs. Part B asks to decide for other teams, which is out of scope (intent.md:16).
7. **decline-no-context** → DECLINE: Technical changelog without application context (intent.md:14-15).
8. **decline-holistic-monorepo** → DECLINE: Single recommendation for 45 packages with different constraints (intent.md:16 — decide for other teams).

## Files

- **intent.md** — Approved intent with risk class definitions (§36-38), Trigger/boundary, Judgment principles, Output contract (including mixed-request form §60-62), Skill shape.
- **fixture.json** — Metadata: `kind: "request"` and 8 case names.
- **cases/\*.md** — Each case with application context, dependency change, supporting evidence. Observable facts only. Source-file line numbers (e.g. "line 52-67 in crypto-utils.c") refer to application code, not the case file itself.
- **check.py** — Deterministic structural validator: correct verdict per case, section order, non-empty sections, Precautions requirement, evidence citation validity (§N.M, [EN], and line numbers mentioned in input or within case-file range).
- **calibrate.py** — Validates check.py: valid cases must pass; one mutation per structural invariant must fail.
- **judge-rubric.md** — Per-case mapping to intent clauses (quoted verbatim), risk class definitions, and deciding criterion (a)/(b)/(c). Violation definitions for blind judge validation.

## Structural Checks in check.py

- First non-empty line is exactly `VERDICT: <one of ACCEPTABLE, ACCEPTABLE-WITH-PRECAUTIONS, UNACCEPTABLE, DECLINE>`.
- Verdict matches the expected single verdict for the case (from risk class definitions).
- For non-DECLINE verdicts: sections in order (Application use → Change summary → Impact scenarios → Risk classification → Precautions if needed).
- For DECLINE verdicts: no review sections; at least one reason line.
- All sections in an upgrade verdict are non-empty.
- Precautions: required for ACCEPTABLE-WITH-PRECAUTIONS and UNACCEPTABLE; omitted only for ACCEPTABLE without precautions; if present, must be non-empty.
- Every §N.M reference exists in input case.
- Every [EN] reference exists in input case.
- Every line reference (line N or line N-M or lines N-M) is either (1) within case-file range 1..len(case), or (2) mentioned in input via "line(s)" phrase.

## Running the Evaluation

```bash
# Calibrate check.py (verify all invariants enforced)
python3 calibrate.py

# Run a case through a downstream agent
# Agent produces answer.md in <trial_workspace>/

# Check structural compliance
python3 check.py <case_name> <trial_workspace>
# Exits 0 if pass; prints {"pass": bool, "findings": [...]}.

# Blind judge validates semantic correctness:
# - Does the verdict follow uniquely from intent risk classes and case facts?
# - Is reasoning evidence-grounded and specific?
# - Are boundaries and mixed-scope handling respected?
```

## Design Principles

- **Structural floor only:** check.py enforces grammar, section order, citation existence, and completeness. Semantic quality (reasoning depth, evidence grounding, calibration) is the blind judge's responsibility.
- **No semantic proxies:** All checks are directly observable structural invariants from the Output contract. No substring scans, keyword presence, character counts, or learned patterns.
- **Contrasting cases:** Cases 2 and 3 both involve breaking changes but have opposite verdicts (AWP vs UNACCEPTABLE) due to one fact: workaround existence. This discriminates between agents that skip critical details.
- **Per-case single verdicts:** Risk class definitions make each expected verdict unique and mutually exclusive within a case.
