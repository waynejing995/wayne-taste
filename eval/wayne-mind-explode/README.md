# Wayne Mind Explode eval

This harness tests the design workflow without relying on globally installed skills
or gstack. It owns four frozen cases:

- `complete`: all product choices are approved; the design pipeline must finish.
- `gstack-ban`: repository policy forbids legacy review entrypoints; two available
  provider-neutral review voices must both revise and then pass the spec.
- `conflict`: approved inputs contradict each other; ask one recommended question
  and stop before writing the spec.
- `staged-durable`: process source-resolved branches, persist each decision, then
  stop at the next genuine user choice.

The complete case also owns a provider-trace oracle: every decision must become
durable in its own file-write event. A correct final decision log does not repair a
batched trace.

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
  --output eval/.runs/wayne-mind-explode/control-gstack-ban/codex-final.txt \
  --trace eval/.runs/wayne-mind-explode/control-gstack-ban/codex-trace.log \
  --provider codex
```

`control.sha256` freezes the pre-optimization skill. Generated trials, candidates,
provider state, and traces belong under `eval/.runs/wayne-mind-explode/`.

The reproduced control failure from the prior complete run is:

```text
write 1: decisions 1-10
write 2: decisions 11-19
write 3: decisions 20-23
write 4: decisions 24-25
```
