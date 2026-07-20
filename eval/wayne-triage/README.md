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

Tracker cases also require one non-empty `## Proposed tracker comment`. The
deterministic checker owns only that structure and tracker-state immutability;
[the blind rubric](semantic-rubric.md) owns whether the proposal is complete and
whether the result preserves the no-publication boundary. It also owns prose-only
questions, classifications, failure meaning, and invocation claims; the checker
does not infer those meanings from punctuation or keywords.

Internal handoffs are checked against the repository's real `wayne-checkpoint`
Skill and canonical packet template, not a local substitute.

## Calibrate

```bash
uv run --no-project python eval/wayne-triage/calibrate.py
```

## Prepare and check

```bash
bash eval/wayne-triage/prepare_trial.sh failure wayne-triage \
  eval/.runs/wayne-triage/control-failure

uv run --no-project python eval/wayne-triage/check_trial.py \
  eval/.runs/wayne-triage/control-failure --case failure \
  --output eval/.runs/wayne-triage/control-failure/codex-final.txt
```

Run the trial through `eval/run_isolated_agent.sh`. Generated candidates, traces,
workspaces, and provider state stay under gitignored `eval/.runs/wayne-triage/`.
