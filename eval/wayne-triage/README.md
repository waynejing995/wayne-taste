# Wayne Triage eval

This harness freezes all front-door routes claimed by `wayne-triage`:

- `failure`: reproducible internal logic bug with a failing test → `fix-now`.
- `tracker`: fully specified shared-interface enhancement → `needs-plan`.
- `missing-data`: tracker ID without item data or fetch method → ask once and stop.
- `multiple-signal`: tracker bug plus crash and environment skew → combine the
  tracker, crash, and config paths; shared blast radius → `needs-plan`.
- `no-match`: a vague artifact with no supported symptom signal → `needs-info`.

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
