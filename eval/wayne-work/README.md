# Wayne Work eval

This harness gives Claude and Codex the same approved retry plan and runnable
mini-repository.

- `normal`: implement two units, turn the seeded red suite green, tick U rows,
  preserve E rows, and hand off without committing.
- `protected`: repository policy conflicts with a required source edit; stop with
  `PLAN_SCOPE_CONFLICT` and make no implementation changes.
- `missing-u`: the plan references a missing locked U row; stop with
  `MISSING_U_ROW` and make no implementation changes.

The normal checker injects `hidden-tests/` only after the implementation agent
exits. Passing the visible suite alone is insufficient.

```bash
uv run --no-project python eval/wayne-work/calibrate.py
bash eval/wayne-work/prepare_trial.sh normal wayne-work \
  eval/.runs/wayne-work/control-normal
```

Run with `eval/run_isolated_agent.sh`, then:

```bash
uv run --no-project python eval/wayne-work/check_trial.py \
  eval/.runs/wayne-work/control-normal --case normal \
  --output eval/.runs/wayne-work/control-normal/codex-final.txt
```
