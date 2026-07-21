# Eval: wayne-test-design — committed control vs accepted candidate

## Frozen inputs

- Control tree: `1d66b0ac715c2a574c8ef7d8ab364ad3cd022628`
- Control `SKILL.md`: `85873b970daea0eeb9278b16d51702eda47eaf0758a369860cf86b5ecec6bad9`
- Owner draft `SKILL.md`: `54b253c32bb25d6f6ba865146962c412fb7f30a2015916377699dc6bb0d8ab4a`
- Frozen harness: `aa3827277a8df45c3652abbf2fda38b7fa838f9f258f140f93cf9869c3b86ebb`
- Accepted `SKILL.md`: `a5667bffc55951cfc628a5eece307f30de0e2a99da122d69ddc31466fcb621a3`
- Accepted template: `47850a50a4b4dad93601138ac6b4e24b8cd16627f1da9bbe7db0cd8108daa7ba`
- Models: Claude Opus 4.8 / high; `dvue-aoai-001-gpt-5.6-sol` / high

The first candidate run was invalidated after the frozen checker was shown to
overfit wording such as `fan-out`, `cleanup`, `lower`, and `empty`. The checker was
repaired, independently mutation-calibrated, re-frozen, and all cells below were run
from fresh workspaces and provider state.

## Paired behavior

| Case | Claude control | Claude candidate | Codex control | Codex candidate | Candidate invariant |
|---|---|---|---|---|---|
| provider-isolation | fail | pass | fail | pass | provider rows, native attestation, honest weaker mode, retained fan-out outcomes |
| proof-axis | fail | pass | fail | pass | independent stream, resume, policy, and child-plus-lease cleanup proof |
| missing-native-evidence | fail | pass | fail | pass | intent is not capability proof; unresolved conflict blocks planning |
| simple | fail | pass | fail | pass | exact U-SEED behavior without invented E2E scope |
| absorb-existing | fail | pass | fail | pass | existing E row carried verbatim exactly once into the matrix SSoT |

Candidate result: **10/10 pass**. Control result under the same frozen harness:
**0/10 pass**. No provider cell was invalid.

## Static and calibration gates

- Forge validation: `0 error(s), 0 warning(s)`
- Behavioral checker calibration: 5 positive lanes, 42 independent mutations
- Historical-intent static calibration: 1 positive lane, 18 independent mutations
- Accepted candidate static intent: pass
- Python compile and shell syntax: pass
- Live path equals accepted candidate byte-for-byte: pass
- Fresh live-path provider-isolation smoke: Claude pass, Codex pass

The static guard retains original design intent that the initial failure-focused
matrix missed: converged direct input, test-relevant decisions, row-level lesson
trace, fixed runtime location, dated NNN naming, `E2E: none` absorption, blocked
conflict termination, and nested mind-explode return-only routing.

## Size and verdict

| Version | SKILL.md lines | SKILL.md words | Forge |
|---|---:|---:|---|
| committed control | 441 | 3381 | historical control |
| owner draft | 510 | 3970 | 2 errors / 2 warnings |
| accepted candidate | 157 | 1058 | 0 errors / 0 warnings |

Verdict: **accept**. The candidate fixes all three target failure families, preserves
the held-out simple and absorption behaviors, and restores the historical workflow
intent before taking the size reduction.

Residual uncertainty: the provider set is intentionally small and evaluates generated
matrix artifacts rather than a full downstream `wayne-plan`/`wayne-verify` execution.
The original trial's mechanical results are historical evidence only.

## 2026-07-21 AI-matrix boundary hotfix

The Test Matrix is an AI-to-AI artifact. U/E proof information, source fidelity,
status ownership, provider isolation, and native-evidence requirements remain; exact
headings, seven-column layout, section order, and table grammar are now advisory.
Legacy checker results may locate evidence but no longer decide semantics. No provider
cell was rerun for this prompt-only boundary change.
