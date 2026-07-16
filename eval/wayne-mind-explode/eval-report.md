# Wayne Mind Explode intent-recovery A/B

## Versions

| Side | Skill SHA-256 | Lines | Words | Forge static |
|---|---|---:|---:|---|
| Control | `6cffd98627e1bc23162e3d87f4fee5453770aefe01c5e62ee4dbf1a09d0c560a` | 170 | 1,017 | 0 errors, 0 warnings |
| Candidate | `3236845ca1bdca1c368170037c7ba6b0eee71a09b94807c0b19e4eeeb94b71f5` | 211 | 1,334 | 0 errors, 1 line-target warning |

The 41-line increase restores state transitions and dense review/approval contracts;
it does not restore the old 513-line checklist or any forbidden review dependency.

## Exact reproduced failure

The previous complete-case Codex trace passed the final-artifact checker while its
decision writes added 10, 9, 4, and 2 rows at a time. The new provider-trace oracle
checks the actual file-write events, not only the final Markdown.

| Agent, same `staged-durable` task | Control | Candidate | Result |
|---|---|---|---|
| Claude Opus, high effort | FAIL: one write appended 6 decisions | PASS: one decision per durable write | candidate win |
| Codex, high effort | FAIL: one write appended 5 decisions | PASS: one decision per durable write | candidate win |

Both candidates stopped at the same real user choice with one recommended question.
They wrote only an in-progress decision log: no matrix, spec, review, checkpoint,
implementation, or plan.

## Regression and deterministic gates

- Candidate unresolved-conflict case: Claude PASS, Codex PASS.
- Checker calibration: 4 positive fixtures and 11 independent mutations PASS.
- Source enum and unique consecutive decision IDs are now checked.
- Review reports are explicit immutable evidence; the decision log remains the sole
  owner of resolutions and final review outcomes.
- gstack and its legacy review entrypoints remain prohibited and absent.

## Verdict

Accept. The exact user-observed temporal failure flips on both model families with
no conflict-gate regression. The larger candidate also restores the original
product/engineering review playbooks, written-spec approval, reviewer-unavailable
failure, KB coverage, cybernetics intervention choice, and indirect-consumer scan.

Residual uncertainty: the corrected written-spec approval is inherently multi-turn.
This run stops before that gate and does not re-claim the old single-turn complete
handoff as proof. A future multi-turn harness should approve the written spec, test
reviewer unavailability, verify `wayne-test-design` invocation ownership, and then
exercise final handoff without planner execution.
