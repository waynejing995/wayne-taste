# Wayne Plan eval

This harness reproduces the complex `wayne-plan` optimization case used to test
source fidelity, blocker terminals, and downstream implementation transfer.

## Review evidence

`calibrate.py` and `check_trial.py` are retained as historical observation tools.
Their heading, table, line-count, regex, and filename findings do not pass or fail
plan semantics. Give the complete sources, repository, produced plan, downstream
executor result, and observations to the independent source-fidelity and
execution-readiness AI rubrics.

## Behavioral cases

- `cases/normal/`: complete sources; one approved plan should be written.
- `cases/conflict/`: an active-plan conflict must stop with `PLAN_CONFLICT`.
- `cases/missing-e2e/`: missing E ownership must stop with `MISSING_E2E`.

Use `trial-task.md` for both control and candidate. The legacy checker may collect
bounded observations:

```bash
uv run --no-project python eval/wayne-plan/check_trial.py \
  <trial-repo> eval/wayne-plan/cases/normal --case normal
```

For a blocker, add `--output <agent-final.txt>` and select its case, then judge the
blocker meaning with the AI rubric rather than line shape.

## Downstream transfer

Give a fresh executor only the produced plan plus a clean copy of the runnable
fixture. Use `implementation-task.md`; inject
`hidden-tests/test_delivery_retry_acceptance.py` only after the executor exits.
Passing the plan checker without passing these tests is not sufficient.

`approved-intent.md` and `generation-task.md` are the frozen inputs for a Forge
meta-eval that generates a revised planning skill. Do not expose the checker or
hidden test to the generation or downstream agent.
