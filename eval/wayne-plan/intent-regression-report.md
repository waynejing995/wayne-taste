# Plan intent-regression hotfix

The candidate tree is
`d2c5411eaa447846f0e8a5b18173d0aef95c5c8496435bf35ff782d531ca580b`
(166 lines / 1684 words). Forge static reports 0 errors and the existing word-target
warning.

## Recovered intent

- Restore semantic lesson-trigger matching, relevant lesson provenance/prevention,
  concrete mitigation, non-match exclusion, and explicit none/dismissed outcomes.
- Restore the default Chinese user-visible summary while keeping the plan English;
  an exact caller response still overrides the default.
- Do not restore the old `plan-complete` decision-log writeback. The current shared
  identifier contract intentionally moved decision-log status to a single upstream
  owner and makes it read-only after `design-approved`.

## Gates

- Plan calibration: PASS for the normal artifact, 19 independent invalid mutations,
  four valid prose/symbol variants, and both exact blocked contracts.
- Pipeline-ID calibration: PASS.
- Forge static: 0 errors, 1 size warning.
- Blind lesson/language/owner rubric: frozen for the normal fixture.

## Live cells

| Task | Model | Result | Classification |
|---|---|---|---|
| full normal Plan intent case | Claude Opus 4.8 | exceeded 10 minutes; no plan artifact | invalid |
| full normal Plan intent case | Codex `dvue-aoai-001-gpt-5.6-sol` | provider stream disconnected before completion | invalid |
| identical Codex rerun | Codex `dvue-aoai-001-gpt-5.6-sol` | exceeded 8 minutes; no plan artifact | invalid |

No partial output was repaired or scored. These cells provide no behavioral
win/loss evidence. Acceptance of this hotfix rests on the explicit pre-slim intent,
the current single-owner contract, and deterministic regression coverage; a future
smaller trace-enabled presentation/lesson case should close the model-execution gap.

Follow-up 2026-07-21: the old plan grammar calibration is removed. `check_trial.py`
now emits observations with `AI_REVIEW_REQUIRED` and never treats headings, tables,
line counts, or regex as the semantic verdict. Source-fidelity, execution-readiness,
and downstream implementation evidence own acceptance.
