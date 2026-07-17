# Eval: wayne-verify — control vs candidate

Date: 2026-07-17

## Versions

| Side | Source-tree SHA-256 | SKILL.md SHA-256 | Size | Forge static |
|---|---|---|---:|---|
| Control | `f42ecc2443128e33dc790199d3d031bd4822e6c638a1d0e2476dbd0308c7f777` | `9a7e995f4f7934dbbac2f97efc6731299fda2de69d89da8fbedeec2f37ee671d` | 303 lines / 2,150 words | 1 error, 3 warnings |
| Candidate | `5413f254d0f07c9d58b39427cbb0d3f74c17cae3ca7ddacab79e16f8b3d25fab` | `3076d346dedf9e467a08343138d1ec0d7a05b87914c46c82c0d0865001929adb` | 128 lines / 784 words | 0 errors, 0 warnings |

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

- Behavior checker calibration: PASS, 9 positive lanes and 42 independent
  mutations.
- Frozen tasks/fixtures/checker hash:
  `bbddff749d67031f940d1bd39f3162f391a0d404a9e7f44c336e4ac2a2258436`.
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
