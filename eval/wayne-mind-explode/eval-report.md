# Eval: Wayne Mind Explode

## Versions

| Side | Skill SHA-256 | Lines | Words | Forge static |
|---|---|---:|---:|---|
| Control | `e00506d534f4d570d85b6d73a5658fd549042579953f67724f37aeb6f8bf4144` | 513 | 3659 | 2 errors, 1 warning |
| Candidate | `6cffd98627e1bc23162e3d87f4fee5453770aefe01c5e62ee4dbf1a09d0c560a` | 170 | 1017 | 0 errors, 0 warnings |

The control tree hash is frozen in `control.sha256`. Candidate behavior used
Claude Opus 4.8 at high effort and `dvue-aoai-001-gpt-5.6-sol` at high effort.

## Results

| Case | Claude control | Codex control | Claude candidate | Codex candidate |
|---|---|---|---|---|
| `gstack-ban` | PASS | PASS | PASS | PASS |
| `complete` | not required for classification | not required for classification | PASS | PASS |
| `conflict` | not required for classification | not required for classification | PASS | PASS |

The control's forbidden reviewer dependency did not reproduce as a downstream
failure: both strongest models applied higher-priority repository policy and found
the neutral reviewer. The accepted change is therefore a portability repair plus
pure slimming, not a claimed control-fail/candidate-pass win.

Candidate v1 was rejected. Claude edited the spec after both review verdicts and
made their hashes stale; Codex used a valid relative matrix link that the original
checker rejected. The final candidate explicitly invalidates reviews after any spec
edit, while the corrected checker accepts both repo-relative text and resolving
Markdown links. Its frozen calibration passes two positive fixtures and seven
independent mutations.

## Verdict

Accept. All six candidate behavior cells pass; no task-success or hard-boundary
regression is observed; the prohibited static dependency is gone; and context drops
by 343 lines and 2642 words. The grilling loop follows Matt Pocock's public
`grilling` semantics at commit `170ad4865582`.

Residual uncertainty: the harness covers a one-turn unresolved conflict and two
fully approved end-to-end designs. It does not automate a long live human interview
across many turns or exercise production installations of the three downstream
Wayne skills.
