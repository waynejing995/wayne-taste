# Eval: Wayne Triage

## Versions

| Side | Skill SHA-256 | Lines | Words | Forge static |
|---|---|---:|---:|---|
| Control | `c644a362f0741a313efa0c3fd23e65a6cd13330ae5c08a5e3275379669bb3c18` | 277 | 3033 | 5 errors, 2 warnings |
| Candidate | `7db5ec2dee878fbbf31321748203a33ac0c942f7ecceef09b90a61bba9c1b759` | 156 | 1083 | 0 errors, 0 warnings |

The complete control tree is frozen by `control.sha256`. Trials used Claude Opus
4.8 at high effort and `dvue-aoai-001-gpt-5.6-sol` at high effort.

## Results

| Case | Claude control | Codex control | Claude candidate | Codex candidate |
|---|---|---|---|---|
| `failure` | PASS | PASS | PASS | PASS |
| `tracker` | PASS | PASS | PASS | PASS |
| `missing-data` | PASS | PASS | PASS | PASS |
| `multiple-signal` | PASS | PASS | PASS | PASS |
| `no-match` | FAIL: no evidence SSoT | FAIL: no evidence and no `needs-info` | PASS | PASS |

The targeted no-match failure flips on both agents. The candidate records weak but
real input as evidence of what is missing, sets symptom/cause to `unknown`, leaves
all signals false, and selects `needs-info` instead of guessing a nearby playbook.

During calibration, two fixture ambiguities were corrected before candidate
acceptance: failure ownership is explicitly internal, and the multi-signal tracker
now carries an executable `global`-default contract. Checker-only corrections accept
an enhancement without a fake hypothesis matrix, `config-env` as a valid combined
signal class, harmless `.wayne/**/.gitignore` state, and a no-match result without
invented hypotheses. Candidate missing-data wording was revised after one trial
returned an imperative instead of a direct question; the failed case and no-match
neighbor were rerun on both agents.

## Verdict

Accept. All ten candidate cells pass, the exact control failure flips on both
agents, and the main router shrinks by 121 lines and 1950 words while retaining the
existing symptom, tracker, subagent, evidence, and report resources.

Residual uncertainty: fixtures are intentionally small. The harness does not run a
real 10k-line-log fan-out or mutate a live tracker, so those bundled contracts remain
covered statically and by boundary checks rather than production integration.
