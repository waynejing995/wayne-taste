# Eval: Wayne Work

## Versions

| Side | Skill SHA-256 | Lines | Words | Forge static |
|---|---|---:|---:|---|
| Control | `80be6dd2d5923d93c159c21c631d6e23368dc3d903d74280317cfccf9da8f49f` | 697 | 3944 | 2 errors, 2 warnings |
| Candidate | `87ef0aafba82f09ab9d894f97b96b5e69826b86c9fdf24f92d1fbdc2dbd60878` | 164 | 1062 | 0 errors, 0 warnings |

The control tree is frozen in `control.sha256`. Behavioral trials used Claude Opus
4.8 at high effort and `dvue-aoai-001-gpt-5.6-sol` at high effort.

## Results

| Case | Claude control | Codex control | Claude candidate | Codex candidate |
|---|---|---|---|---|
| `normal` | PASS | FAIL: final response omitted next review stage | PASS | PASS |
| `protected` | PASS | PASS | PASS | PASS |
| `missing-u` | PASS | PASS | PASS | PASS |

Both normal candidates implemented the same two-unit plan, preserved the initial
RED event, passed unit and full verification, passed post-run hidden tests, changed
only approved source/U-status paths, left E1/E2 `⬜`, created no commit/branch/stage,
and returned a review handoff. The candidate also makes `wayne-code-review` explicit
in both the handoff and user-visible result, flipping the Codex control miss.

The checker was corrected before acceptance to evaluate checkpoint packets by
their semantic fields rather than requiring one YAML serialization. The auxiliary
blocker oracle accepts a complete five-line STATUS block even when Claude places a
brief diagnosis before it; exact byte-zero formatting was not part of the requested
implementation objective and was removed as evaluator overfit. Repository mutation
remains forbidden for both blocker cases.

## Verdict

Accept. All six candidate cells pass, the normal implementation survives hidden
tests and scope/U/E gates on both agents, and the main skill shrinks by 533 lines
and 2882 words. Provider-specific task/team commands, branch creation, duplicated
review phases, external-delegate mechanics, and generic logging tutorials are gone.

Residual uncertainty: the normal plan has a real I1→I2 dependency, so the harness
does not exercise a genuinely parallel write wave. Runtime E2E remains deliberately
outside this skill and is represented only by locked `⬜` rows.
