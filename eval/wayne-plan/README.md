# Wayne Plan eval

This harness reproduces the complex `wayne-plan` optimization case used to test
source fidelity, blocker terminals, and downstream implementation transfer.

## Review evidence

`check_trial.py` is retained as a historical observation tool. Its heading, table,
line-count, regex, and filename findings do not pass or fail plan semantics. Give the
complete sources, repository, produced plan, downstream executor result, and
observations to the independent source-fidelity and execution-readiness AI rubrics.

## Behavioral cases

- `cases/normal/`: complete sources; one approved plan should be written.
- `cases/conflict/`: an active-plan conflict must stop with `PLAN_CONFLICT`.
- `cases/missing-e2e/`: missing E ownership must stop with `MISSING_E2E`.

Behavioral cases use `trial-task.md` for control and candidate. The normal intent trial is built
by `prepare_intent_trial.sh <skill-dir> <workspace>`, which copies `intent-regression-task.md` to
`task.md`. Both layouts put the git fixture at `<workspace>/repo`, the state seeds at
`<workspace>/wayne-home/projects/repo/`, and `_shared/` and `skill/` beside them.

Run each agent with `eval/wayne-plan/run_agent.sh <claude|codex> <workspace> <run-state>`
after setting `MODEL` and `EFFORT`. It pins `WAYNE_HOME=/workspace/wayne-home` and starts in
`/workspace/repo`, which the skill's `<state>` resolver requires. The generic
`eval/run_isolated_agent.sh` starts in `/workspace`, so it is not used here.

The legacy checker may collect bounded observations from the trial `<workspace>` and the
case directory that seeded it:

```bash
uv run --no-project python eval/wayne-plan/check_trial.py \
  <workspace> eval/wayne-plan/cases/normal --case normal
```

For a blocker, pass that case's directory (`cases/conflict` or `cases/missing-e2e`) as the
baseline and `--output <workspace>/codex-final.txt` (Codex) or
`<workspace>/claude-final.txt` (Claude). Judge the blocker meaning with the AI rubric
rather than line shape.

## Downstream transfer

Give a fresh executor only the produced plan plus a clean copy of the runnable
fixture. Use `implementation-task.md`; inject
`hidden-tests/test_delivery_retry_acceptance.py` only after the executor exits.
Passing the plan checker without passing these tests is not sufficient.

`approved-intent.md` and `generation-task.md` are the frozen inputs for a Forge
meta-eval that generates a revised planning skill. Do not expose the checker or
hidden test to the generation or downstream agent.
