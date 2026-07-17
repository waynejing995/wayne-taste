# Wayne Checkpoint eval

This harness freezes the handoff conductor contract. It tests five inputs:

- `plan-regression`: the existing linear pipeline still routes plan to work;
- `fix-now`: preserve a caller-selected test-design target and triage metadata;
- `needs-plan`: preserve another caller-selected test-design target;
- `escalate-architecture`: preserve a caller-selected design target;
- `external`: an out-of-pipeline incident produces no Wayne handoff packet.

Triage owns verdict-to-capability selection; checkpoint validates and packages the
selected target. The checker validates the real packet schema, one existing Skill,
the evidence snapshot, manual/no-auto-advance semantics, and repository immutability.

## Calibrate

```bash
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
uv run --no-project python eval/wayne-checkpoint/check_trial.py \
  eval/.runs/wayne-checkpoint/control-fix-now-codex --case fix-now \
  --output eval/.runs/wayne-checkpoint/control-fix-now-codex/codex-final.txt
```

Generated workspaces, candidates, model state, and traces live only under
`eval/.runs/wayne-checkpoint/`.
