# Wayne Skill Optimize A/B — superseded final7

This result used the retired lexical evaluator and is not evidence for the current
candidate. The replacement harness separates deterministic integrity from Claude
and Codex semantic source-fidelity review. A fresh paired run is required before a
new acceptance claim.

The frozen meta-eval asks each optimizer to recover and freeze the complete intent
of the same two-commit `decision-builder` fixture. The natural task mentions only
the available evidence and feedback; it does not reveal the expected intent gaps.

| Agent | Control | Candidate | Pair result |
|---|---|---|---|
| Codex, high effort | FAIL: initial commit, exact feedback/policy sources, and forbidden-dependency absence oracle missing from coverage | PASS | candidate win |
| Claude Opus | PASS | PASS | tie |

- Deterministic checker calibration: PASS, positive fixture plus 17 independent mutations.
- Forge static validation: PASS, 0 errors and 0 warnings.
- Control SKILL hash: `30641309bea74ae854e354aba7b55c96716800a2ecab7ec79b88e399cd86195b`.
- Candidate SKILL hash: `64a5ef8a394700650e2f6b46b70a20b9b3b9caf0c880d9e06b59ad380a60bad8`.
- Size: 129 lines / 837 words → 168 lines / 1,274 words.
- Verdict: accept. Candidate has one cross-agent win, one tie, and no observed
  hard-boundary regression. The extra context is justified by recovered source,
  temporal, capability-replacement, and oracle-completeness gates.
- Residual uncertainty: one synthetic procedure-skill fixture; lens/router transfer
  is not measured by this target-specific optimizer eval.

Earlier cells were invalidated when evaluator defects were found or when a
candidate iteration failed. They are preserved under the gitignored
`eval/.runs/wayne-skill-optimize/` and are not included in this verdict.
