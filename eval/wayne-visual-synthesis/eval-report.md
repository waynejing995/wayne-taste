# Eval: Wayne Visual Synthesis

## Versions

| Side | Tree SHA-256 | Skill SHA-256 | Lines | Words | Forge static |
|---|---|---|---:|---:|---|
| Control | `308b4ba1d5c2429dbf5edb1e7621b679f8b42ddf2440bdcea2616b8087470641` | `42cfa8ac13b4ddaf0a20f37143efe7899175e323d301dd49a93200e313c58782` | 707 | 5051 | 3 errors, 3 warnings |
| Candidate | `7fb697927f86a250897fcdc1fc9451cea78cceaf704aa968186dce0ee4c8e2cc` | `18471f99787ceb54014fe2c0e2cc0887b389e2255b4f86d653abfeaa0b2bcde9` | 157 | 972 | 0 errors, 0 warnings |

Trials used Claude Opus 4.8 at high effort and
`dvue-aoai-001-gpt-5.6-sol` at high effort. The frozen harness hash is in
`harness.sha256`; original intent is traced in `behavior-coverage.md`.

## Behavioral results

| Case | Claude control | Codex control | Claude candidate | Codex candidate |
|---|---|---|---|---|
| `describe` | PASS | PASS | PASS | PASS |
| `ocr` | FAIL: no complete VEL | FAIL: bare transcript, no VEL | PASS | PASS |
| `compare` | FAIL: byte hash skipped Level 2 | PASS | PASS | PASS |
| `pixel-noise` | PASS | PASS | PASS | PASS |
| `semantic-change` | PASS | PASS | PASS | PASS |
| `hidden-channel` | PASS | FAIL: conclusion preceded VEL | PASS | PASS |
| `missing-image` | PASS | PASS | PASS | PASS |
| `multi-no-compare` | PASS | PASS | PASS | PASS |

Control passes 12/16 cells; candidate passes 16/16. The candidate flips every
observed control failure on both agents where applicable and retains every control
pass. It also resolves the control's contradictory byte-identical short circuit:
hash equality can stop later pixel metrics but cannot skip per-image VEL synthesis
or the Level-2 ledger comparison.

## Static and script gates

- Behavioral checker: 8 positive cases and 18 independent mutations calibrated.
- Original-contract checker: 55 carrier, targetable, and direct-resource mutations
  calibrated.
- Control static failure: `compare_render.py` was not directly routed from the
  Skill; candidate passes the direct-resource contract.
- Control runtime failure: `hidden_probe.py --dump-dir` called removed NumPy 2.x
  `ndarray.ptp()`; candidate uses `np.ptp(spec)` and the real dump command passes.
- Candidate `channel_probe.py`, `hidden_probe.py`, and `compare_render.py` all ran
  on the generated fixtures, not merely through syntax inspection.

## Evaluator corrections

Before candidate generation, checker calibration corrected over-broad verdict
matching, Chinese/English heading equivalents, and blocked zero-entry VEL handling.
After candidate output exposed two equivalent unrecognized phrases (`no ledger
deltas` and `ledger-level comparison`), those cells were invalidated and rerun in
fresh workspaces under the new frozen checker; both passed. No artifact was repaired
or scored manually.

## Verdict

Accept. The candidate restores original design-intent coverage from commits
`df0367a` and `2f3038e`, improves all observed failures, passes both agents, fixes
the bundled NumPy runtime defect, and shrinks the main context by 550 lines and
4079 words. Detailed VEL and compare output contracts move to direct references;
carrier, targetable, probe, and method resources remain intact.

Residual uncertainty: image fixtures are deterministic UI/document rasters. Map,
equation, and arbitrary natural-photo carriers are contract-checked statically but
not each exercised through a model trial. The small matrix proves the published
intent cases, not statistical superiority on all possible images.
