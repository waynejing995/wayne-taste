# Wayne Triage eval

This harness freezes all front-door routes claimed by `wayne-triage`:

- `failure`: reproducible internal logic bug with a failing test → `fix-now`.
- `tracker`: fully specified shared-interface enhancement → `needs-plan`.
- `missing-data`: tracker ID without item data or fetch method → ask once and stop.
- `multiple-signal`: tracker bug plus crash and environment skew → combine the
  tracker, crash, and config paths; shared blast radius → `needs-plan`.
- `no-match`: a vague artifact with no supported symptom signal → `needs-info`.
- `approval-denied`: route is established but no checkpoint may be written.
- `architecture`: three failed fixes → `wayne-mind-explode`.
- `external-owner`: render a report and create no Wayne checkpoint.

Tracker cases require one complete proposed comment. `check_trial.py` emits
`AI_REVIEW_REQUIRED`; its observations may locate a likely proposal and record Git
or tracker-state changes, but only [the blind rubric](semantic-rubric.md) decides
proposal completeness, no-publication meaning, questions, classification, failure
meaning, routing, attribution, and invocation claims. Headings, punctuation,
keywords, frontmatter, and field order are not semantic gates.

Internal handoffs are checked against the repository's real `wayne-checkpoint`
Skill and canonical packet template, not a local substitute.

## Calibrate

```bash
# Calibration proves observation coverage, not report meaning.
uv run --no-project python eval/wayne-triage/calibrate.py
```

## Prepare and check

```bash
bash eval/wayne-triage/prepare_trial.sh failure wayne-triage \
  eval/.runs/wayne-triage/control-failure

Read the evidence file, sources, packet/report, trace, and any checker observations
with the blind rubric before deciding the result.

`check_trial.py` uses the trial's starting Git commit, final diff, and untracked
paths for scope evidence. It never walks or hashes unrelated repository contents.
```

Run the trial through `eval/run_isolated_agent.sh`. Generated candidates, traces,
workspaces, and provider state stay under gitignored `eval/.runs/wayne-triage/`.
