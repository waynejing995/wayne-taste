# Eval: wayne-goal-prompt — control vs candidate

Date: 2026-07-17

## Versions

| Side | Source-tree SHA-256 | SKILL.md SHA-256 | Size | Forge static |
|---|---|---|---:|---|
| Control | `c2a16b962c55f7963ccf860eaa5e9dc94208eb47586d0cdaeaece519e1491a16` | `1cc796561db3b0bbc99201770a6f403a8196d4ea7f7c4450f1c9e58634008ff1` | 329 lines / 2,922 words | 2 errors, 5 warnings |
| Candidate | `7f9cd809413464363e288f5ae39a36559c26dc16b68e09b2623059b32ae010e2` | `96a72914e7770b27fb817abfcc397d5c27dda9d83eea91c4fa5084d91379301e` | 154 lines / 1,010 words | 0 errors, 0 warnings |

The frozen control is Git tree `a56914f8f308e71654e9ed6b61c0d5c662ace3f4`.
Trials used Claude Opus 4.8 and `dvue-aoai-001-gpt-5.6-sol`, both at high
effort, in fresh bwrap-isolated workspaces with the exact skill path supplied.

## Paired behavior result

| Case | Claude control | Codex control | Claude candidate | Codex candidate |
|---|---|---|---|---|
| `vague-missing` | FAIL: batches several decisions | FAIL: batches several decisions | PASS: one Chinese scope question | PASS: one Chinese scope question |
| `compose-real-path` | PASS | PASS | PASS | PASS |
| `existing-plan` | FAIL: copies unit-body mechanics | PASS | PASS: unit ID/outcome only | PASS |

The candidate flips all three observed control failures and preserves all three
control-pass cells. Final candidate result is 6/6 PASS with no invalid cell.

## Runtime and deterministic gates

| Gate | Control | Candidate |
|---|---|---|
| Startup provider failure | FAIL: success/job ID emitted; provider reason lost | PASS: initialize and `turn/start` failures are non-zero before ready/job ID; log/reason preserved |
| Blocked same-thread resume | FAIL: no working resume/reactivation/completion | PASS: blocked remains live; same thread set active and completes |
| Composition checker calibration | — | PASS: 6 positives + 19 independent mutations |
| Candidate static calibration | — | PASS: 1 positive + 53 independent mutations |
| Goal validator calibration | — | PASS: 2 positives + 10 independent mutations |
| Dispatch report calibration | — | PASS: 1 positive + 16 independent mutations |
| Live-path `compose-real-path` smoke | — | PASS: Claude and Codex |
| Python compile, shell syntax, Forge validation | legacy static failures | PASS |

## Rejected and invalid iterations

| Candidate tree SHA-256 | Observation | Disposition |
|---|---|---|
| `8c47c81b7b6dff02dd1a3a05246dad098e147f86277fcd172589a8e78ccc5094` | Claude still batched vague questions and copied plan detail | rejected; narrowed one-decision and plan-SSoT rules |
| `9a26c6805039bf36710e085a0dc36937deab14f1594df9ced1f9382067ec8379` | target failures flipped, but markdown-wrapped `non-TransientError` exposed a checker false negative | evaluator invalidated, calibrated for equivalent Markdown, rerun |
| `9a26c6805039bf36710e085a0dc36937deab14f1594df9ced1f9382067ec8379` | Claude recovered an old skill from host transcripts instead of reading the candidate | infrastructure invalid; runner isolated and exact skill path added |
| `9a26c6805039bf36710e085a0dc36937deab14f1594df9ced1f9382067ec8379` | `是否准确无误` exposed a confirmation-synonym checker gap; plan case still copied `decision tree` | evaluator fixed and calibrated; real plan failure drove one bounded edit |
| `7f9cd809413464363e288f5ae39a36559c26dc16b68e09b2623059b32ae010e2` | all composition and dispatch gates pass | accepted |

## Verdict

Accept. On the frozen tasks, the candidate is behaviorally better on both model
families while reducing always-loaded context by 175 lines and 1,912 words. It
also fixes fail-loud startup and same-thread resume behavior rather than merely
rewriting prose.

Residual uncertainty: live long-running app-server success against a real provider
was not launched by this eval. Usage/budget terminal semantics and resume are
covered by static mutations and a deterministic fake app-server protocol run.

Follow-up 2026-07-20: readiness now belongs after a successful initial
`turn/start`. The deterministic fake rejects the previous ordering by failing that
method after goal setup and asserting that no `control/ready` marker or successful
job ID escaped. Initialize failure and same-thread blocked/resume remain passing.

Follow-up 2026-07-21: the runtime goal-Markdown validator was removed. Heading,
phrase, backtick, and section-count checks are historical eval observations only;
semantic composition now belongs to blind AI review. Dispatch protocol checks stay
mechanical because the app-server and shell CLI are real non-AI consumers. The
composition cells above were not rerun for this hotfix.
