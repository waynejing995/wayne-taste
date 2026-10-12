# Forge meta-eval: STE-lite revision

Run `eval/.runs/wayne-skill-forge/2026-10-12-ste-final` (gitignored), driven by `meta_eval.py`.

## Setup

| Item | Value |
| --- | --- |
| Control forge | `92fd871` (before the STE-lite revision) |
| Candidate forge | `01568b5` (defect fixes, `instruction-prose.md`, STE-lite body) |
| Generator | fresh Claude Code 2.1.296, Opus 5.5, effort high, one child per arm and archetype |
| Downstream | fresh Claude (Opus 5.5, high) and Codex (`gpt-6-sol`, high) in the bwrap runner |
| Cases | procedure 3, lens 3, router 5; 44 trials in total |
| Blindness | neutral child IDs; judges read only an anonymized packet outside the run directory |

All six children passed `validate_skill.py`. All 44 trials produced an observable result. No trial was invalid or retried.

## Deterministic gates

Control 22/22 pass, candidate 22/22 pass. No task-success or hard-boundary loss in any cell. The gates hit a ceiling, so they do not separate the arms.

## Blind semantic judge (unblinded after scoring)

| Archetype | Candidate wins | Control wins | Ties |
| --- | --: | --: | --: |
| procedure | 0 | 0 | 6 |
| lens | 3 | 1 | 2 |
| router | 3 | 6 | 1 |
| total | 6 | 7 | 9 |

- Lens: both candidate wins on `decline` came from the control child's agents, Claude and Codex both. They declined and then did the out-of-scope JSON conversion anyway. The frozen checker passed those outputs because they were under 600 characters and had no headings.
- Router: the control child won all six matched-route pairs on route justification and probe quality. The candidate child won three of four `NO_MATCH` pairs because it explained why routing failed.
- Procedure: every report matched its trace and quoted the status line. Only format differed.

## Child size and cost

| Child | Control words | Candidate words |
| --- | --: | --: |
| procedure `SKILL.md` | 640 | 712 |
| lens `SKILL.md` | 1,296 | 1,096 |
| router total (with 3 references) | 1,543 | 1,659 |

Candidate children have 0 semicolons and shorter sentences: average 13.1–16.7 words against 16.9–20.5 for control. Downstream wall time was 701 s for candidate and 767 s for control. Claude output tokens were 22,930 and 25,745.

## Verdict

Accept. The candidate has no task-success or hard-boundary regression, and the blind judge result is parity (6–7–9). This run does not show that STE-lite is better. With one generation per cell, a judge difference inside one archetype can come from that one child, not from the forge.

## Residual uncertainty

- One child per arm and archetype. Generator variance is not measured.
- The deterministic cases are at ceiling. They cannot detect a quality difference between arms.
- No procedure case covers a failed verification that must loop back, which `references/eval.md` §3 requires. The `staged-rollout` intent forbids a second apply, so a verify-failure case there tests a stop boundary, not a loop. Loop-back coverage needs a separate intent and fixture with an explicit recovery action and re-verification contract.
- The lens decline checker missed the out-of-scope work that two control trials did. This is an observed escape, so it may justify a new check.
- The open hypotheses in `references/instruction-prose.md` stay open: a weaker downstream reader was not tested, and trigger recall was not measured.
