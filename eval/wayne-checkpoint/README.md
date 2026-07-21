# Wayne Checkpoint eval

This harness freezes the handoff conductor contract. It tests five inputs:

- `plan-regression`: the existing linear pipeline still routes plan to work;
- `fix-now`: preserve a caller-selected test-design target and triage metadata;
- `needs-plan`: preserve another caller-selected test-design target;
- `escalate-architecture`: preserve a caller-selected design target;
- `external`: an out-of-pipeline incident produces no Wayne handoff packet.

Triage owns verdict-to-capability selection; checkpoint packages the selected
target. Existing checkers emit `AI_REVIEW_REQUIRED` and surface field/path,
Skill-existence, and repository-mutation observations for the
[blind semantic rubric](semantic-rubric.md). They do not decide packet
completeness, routing preservation, ownership, manual/no-auto-advance meaning,
scope/acceptance quality, or invocation claims from Markdown shape.

## Collect observations

```bash
uv run --no-project python eval/wayne-checkpoint/check_template_ownership.py \
  wayne-checkpoint --calibrate
uv run --no-project python eval/wayne-checkpoint/calibrate.py
```

## Prepare and run

```bash
bash eval/wayne-checkpoint/prepare_trial.sh fix-now wayne-checkpoint \
  eval/.runs/wayne-checkpoint/control-fix-now-codex
MODEL=dvue-aoai-001-gpt-5.6-sol EFFORT=high \
  bash eval/wayne-checkpoint/run_agent.sh codex \
  eval/.runs/wayne-checkpoint/control-fix-now-codex \
  eval/.runs/wayne-checkpoint/state-control-fix-now-codex
Read the generated packet, source artifacts, and trace with the blind rubric.
`calibrate.py`, `check_trial.py`, and `check_template_ownership.py` only collect or
calibrate observations; their exact field, heading, and table scans never return a
packet-semantic pass/fail verdict.
```

Generated workspaces, candidates, model state, and traces live only under
`eval/.runs/wayne-checkpoint/`.
