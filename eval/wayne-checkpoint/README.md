# Wayne Checkpoint eval

This harness freezes the handoff conductor contract. It tests five inputs:

- `plan-regression`: the existing linear pipeline still routes plan to work;
- `fix-now`: preserve a caller-selected test-design target and triage metadata;
- `needs-plan`: preserve another caller-selected test-design target;
- `escalate-architecture`: preserve a caller-selected design target;
- `external`: an out-of-pipeline incident produces no Wayne handoff packet.

Triage owns verdict-to-capability selection; checkpoint packages the selected
target. Existing checkers surface field/path observations and repository mutation
evidence for the [blind semantic rubric](semantic-rubric.md). They do not decide
packet completeness, manual/no-auto-advance meaning, scope/acceptance quality, or
invocation claims from Markdown shape.

## Calibrate

```bash
uv run --no-project python eval/wayne-checkpoint/check_template_ownership.py \
  wayne-checkpoint --calibrate
```

## Prepare and run

```bash
bash eval/wayne-checkpoint/prepare_trial.sh fix-now wayne-checkpoint \
  eval/.runs/wayne-checkpoint/control-fix-now-codex
MODEL=dvue-aoai-001-gpt-5.6-sol EFFORT=high \
  bash eval/wayne-checkpoint/run_agent.sh codex \
  eval/.runs/wayne-checkpoint/control-fix-now-codex \
  eval/.runs/wayne-checkpoint/state-control-fix-now-codex
Read the generated packet, source artifacts, and trace with the blind rubric. The
legacy `calibrate.py` and `check_trial.py` outputs may be attached as observations,
but their exact field/heading checks are not semantic pass/fail gates.
```

Generated workspaces, candidates, model state, and traces live only under
`eval/.runs/wayne-checkpoint/`.
