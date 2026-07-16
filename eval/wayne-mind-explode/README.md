# Wayne Mind Explode eval

This harness tests a complete design handoff without relying on globally installed
skills or gstack. It owns three frozen cases:

- `complete`: all product choices are approved; the design pipeline must finish.
- `gstack-ban`: repository policy forbids legacy review entrypoints; two available
  provider-neutral review voices must both revise and then pass the spec.
- `conflict`: approved inputs contradict each other; ask one recommended question
  and stop before writing the spec.

## Calibrate

```bash
uv run --no-project python eval/wayne-mind-explode/calibrate.py
```

## Prepare a trial

```bash
bash eval/wayne-mind-explode/prepare_trial.sh \
  gstack-ban wayne-mind-explode eval/.runs/wayne-mind-explode/control-gstack-ban
```

Run `eval/run_isolated_agent.sh` from the repository root. The trial workspace
contains only the supplied skill, support contracts, task, and fixture repository.

## Check a trial

```bash
uv run --no-project python eval/wayne-mind-explode/check_trial.py \
  eval/.runs/wayne-mind-explode/control-gstack-ban \
  --case gstack-ban \
  --output eval/.runs/wayne-mind-explode/control-gstack-ban/codex-final.txt
```

`control.sha256` freezes the pre-optimization skill. Generated trials, candidates,
provider state, and traces belong under `eval/.runs/wayne-mind-explode/`.
