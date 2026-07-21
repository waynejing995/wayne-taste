# Eval: wayne-verify — control vs candidate

Date: 2026-07-17

## Versions

| Side | Source-tree SHA-256 | SKILL.md SHA-256 | Size | Forge static |
|---|---|---|---:|---|
| Control | `f42ecc2443128e33dc790199d3d031bd4822e6c638a1d0e2476dbd0308c7f777` | `9a7e995f4f7934dbbac2f97efc6731299fda2de69d89da8fbedeec2f37ee671d` | 303 lines / 2,150 words | 1 error, 3 warnings |
| Candidate | `b0f06f74b75e657cdc88f09351e1504844718ba6584d4bea2e62b64a111d8443` | `96fe57314cdf8d01c9fb5fcf88367f0012859f979290ff0abbfb991db5325707` | 133 lines / 825 words | 0 errors, 0 warnings |

The frozen control is Git tree `5033468bd74d17eaddc28fffa86ba7625f12aae0`.
Trials used Claude Opus 4.8 and `dvue-aoai-001-gpt-5.6-sol`, both at high
effort, in fresh isolated workspaces.

## Paired behavior result

| Case | Claude control | Codex control | Claude candidate | Codex candidate |
|---|---|---|---|---|
| `cli-success` | PASS | PASS | PASS | PASS |
| `server-success` | PASS | PASS | PASS | PASS |
| `stale-green` | PASS | PASS | PASS | PASS |
| `startup-failure` | PASS | PASS | PASS | PASS |
| `missing-contract` | PASS | PASS | PASS | PASS |
| `suspect-skip` | PASS | PASS | PASS | PASS |
| `multi-row` held-out | PASS | PASS | PASS | PASS |
| `legit-skip` held-out | PASS | PASS | PASS | PASS |

Control and candidate are both 16/16 PASS. This is pure slimming: behavior parity
is the gate, and the smaller always-loaded context is the tie-breaker.

## Deterministic gates

- Behavior checker calibration: PASS, 9 positive lanes, 1 Flow mutation, and 48
  independent behavior mutations.
- Frozen tasks/fixtures/checker hash:
  `f4dcda56c224757ec64ad2937eeef8da1736c36fc3e788dc7e99e48981722b78`.
- Candidate Forge validation: PASS, 0 errors and 0 warnings.
- Python compile and shell syntax: PASS.
- Live-path held-out `multi-row` smoke: PASS on Claude and Codex.
- Product code and unit-status ownership remained unchanged in every accepted
  trial; only E2E Status and runtime/evidence artifacts were allowed.

## Evaluator invalidations

- Raw trace text initially treated commands echoed from task/files as executed
  commands. The checker now extracts actual tool command events.
- The first CLI fixture said “exactly ALPHA” while writing `ALPHA\n`; the fixture
  was corrected and both control cells rerun.
- Evidence scratch paths were initially over-constrained. `.wayne-verify/` and
  `scratch/` are now calibrated as evidence owners while product edits still fail.
- Equivalent evidence phrases (`5 bytes` / `five bytes`) and Chinese
  `未准备好 ship` exposed representation-only checker gaps. Each evaluator was
  recalibrated and the affected cell rerun fresh.
- Reverse intent audit found missing multi-row and legitimate-skip coverage. Both
  were added as held-out cases after candidate generation; the candidate passed
  without revision.

No candidate behavior edit was made in response to evaluator defects.

## Verdict

Accept. The candidate preserves all observed runtime, status-ownership, failure,
skip, cleanup, and routing behavior on both model families while removing 175
lines and 1,366 words from always-loaded context.

Residual uncertainty: browser UI driving and a real external persistence system
were not exercised. The server case proves readiness, HTTP observable, and teardown;
the multi-row held-out proves ordered continuation after failure.

## 2026-07-20 legitimate-skip Flow hotfix

The Flow again carries a legitimate `E2E: none` declaration through a dedicated
record action, the row loop, and the final gate. Removing that edge fails the new
structural oracle. The harness now requires one manual return-only ship checkpoint
for every PASSED terminal—including a legitimate skip—and zero ship checkpoint for
BLOCKED/FAILED terminals.

| Live case | Model | Structural gate | Blind semantic read |
|---|---|---|---|
| `legit-skip` | Claude Opus 4.8 | PASS | PASS |
| `legit-skip` | Codex `dvue-aoai-001-gpt-5.6-sol` | PASS | PASS |

Both fresh runs validated the skip against the approved requirement, ran no E2E
command, preserved the authoritative matrix, and emitted only a manual
`verify → wayne-ship` checkpoint. The candidate tree is
`0a51a323c0911fad27fa46979b0419750a0fc9198c9745bf5c7996b6101a0a17`
(142 lines / 881 words); Forge static reports 0 errors and 0 warnings.

The first Claude result formatted the controlled verdict as bold Markdown. A
line-shape checker rejected it even though its meaning and token were correct; that
trial was invalidated, the evaluator was changed to recognize only the controlled
verdict token independent of presentation, and the same case was rerun fresh.
Failure/skip route meaning is judged by the blind rubric rather than keyword or
negation regexes.

## 2026-07-21 E2E presentation boundary hotfix

The E2E contract remains authoritative for user path, process, data, entrypoint,
observable, and status ownership. Its Markdown table layout is now advisory because
agents consume it. Runtime commands, fresh events, artifacts, Git mutations, and
status transitions remain observable evidence; blind AI review binds them to the
correct E entry and route. No provider cell was rerun for this prompt-only change.
