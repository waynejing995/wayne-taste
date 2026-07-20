# Wayne Plan eval

This harness reproduces the complex `wayne-plan` optimization case used to test
source fidelity, blocker terminals, and downstream implementation transfer.

## Deterministic calibration

```bash
uv run --no-project python eval/wayne-plan/calibrate.py
uv run --no-project python eval/wayne-plan/calibrate_pipeline_ids.py
```

The calibration proves one valid normal plan, nineteen independent invalid
mutations, two valid CommonMark/symbol variants, clear one-arrow and multi-branch
scenario variants, and exact blocker responses.
The ID calibration proves legacy numeric decisions map to `D<number>` without
source mutation and that review `R01` rows cannot enter the requirement namespace.

## Behavioral cases

- `cases/normal/`: complete sources; exactly one canonical plan must be written.
- `cases/conflict/`: an active-plan conflict must stop with `PLAN_CONFLICT`.
- `cases/missing-e2e/`: missing E ownership must stop with `MISSING_E2E`.

Use `trial-task.md` for both control and candidate. Check normal output with:

```bash
uv run --no-project python eval/wayne-plan/check_trial.py \
  <trial-repo> eval/wayne-plan/cases/normal --case normal
```

For a blocker, add `--output <agent-final.txt>` and select its case.

## Downstream transfer

Give a fresh executor only the produced plan plus a clean copy of the runnable
fixture. Use `implementation-task.md`; inject
`hidden-tests/test_delivery_retry_acceptance.py` only after the executor exits.
Passing the plan checker without passing these tests is not sufficient.

`approved-intent.md` and `generation-task.md` are the frozen inputs for a Forge
meta-eval that generates a revised planning skill. Do not expose the checker or
hidden test to the generation or downstream agent.
