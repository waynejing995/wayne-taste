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
- `dag-iteration`: across three real turns, resolve one choice, persist the child
  frontier, and ask the next dependency-ordered question without early convergence.
- `dag-long`: resume after forty resolved decisions, resolve N41, open N42, and
  continue; decision count is never an exit condition.
- `decision-locked`: start from a fully resolved frontier whose written design is
  not approved; ask for design approval without modifying code or starting work.
- `depth-recommendation`: resolve one parent, expand every supplied causal child,
  and ask a neutral next question with a falsifiable recommendation.
- `three-options`: resume at one non-binary user choice and offer three genuinely
  distinct options with one recommendation. A blind AI judge owns option
  distinctness and viability; the harness does not count labels, bullets, or
  keywords as a semantic proxy.

The complete case also owns a provider-trace oracle: every decision must become
durable in its own file-write event. One write event may rewrite the `meta` line
and any number of node lines — that is how a node is resolved — but it may make at
most one new `decision` record durable. A correct final decision log does not
repair a batched trace.

All three checkers emit `AI_REVIEW_REQUIRED`. Their record, heading, keyword,
punctuation, and question-count findings are observations for
[the blind workflow rubric](semantic-rubric.md), not semantic verdicts. Durable
write events, Git start/diff evidence, review JSON/hashes, artifact creation order,
and forbidden downstream mutations remain direct observations.

The `three-options` result is judged with
`cases/three-options/semantic-judge.md`. Run the same task with Claude and Codex;
give the judge only the case, supplied Skill, and user-visible response, with
provider identity hidden. Both responses must pass. The binary exception is a
semantic claim: a response cannot earn it merely by saying “binary.”
The general rubric also owns causal DAG depth, fact/choice ownership, convergence,
design approval, review, and handoff semantics across the other cases.

## Calibrate

```bash
uv run --no-project python eval/wayne-mind-explode/calibrate.py
uv run --no-project python eval/wayne-mind-explode/calibrate_dag.py
```

Freeze the executable harness from the repository root after calibration:

```bash
find eval/wayne-mind-explode -type f \
  ! -path '*/__pycache__/*' ! -name harness.sha256 ! -name eval-report.md -print0 \
  | LC_ALL=C sort -z | xargs -0 sha256sum | sha256sum | cut -d' ' -f1
```

## Prepare a trial

```bash
bash eval/wayne-mind-explode/prepare_trial.sh \
  gstack-ban wayne-mind-explode eval/.runs/wayne-mind-explode/control-gstack-ban
```

Run `eval/run_isolated_agent.sh` from the repository root. The trial workspace
contains the complete supplied skill (`skill/`, including its `templates/` and
`references/`), the shared pipeline contract at `_shared/pipeline-id-contract.md`
so the skill's own `../_shared/` link resolves, the support contracts, the task,
and the fixture repository — nothing else.

## Check a trial

```bash
uv run --no-project python eval/wayne-mind-explode/check_trial.py \
  eval/.runs/wayne-mind-explode/control-gstack-ban \
  --case gstack-ban \
  --output eval/.runs/wayne-mind-explode/control-gstack-ban/codex-final.txt \
  --trace eval/.runs/wayne-mind-explode/control-gstack-ban/codex-trace.log \
  --provider codex
```

`control.sha256` and `dag-control.sha256` freeze pre-optimization skill revisions
and stay untouched; only `harness.sha256` is regenerated after calibration.
Generated trials, candidates, provider state, and traces belong under
`eval/.runs/wayne-mind-explode/`.

Scope evidence comes from the trial's starting commit, final diff/untracked paths,
and native trace. The evaluator never walks or hashes unrelated repository files.
The only durable output a design run may leave in the tracked tree is
`docs/specs/<topic>.md`; run state lives in `.wayne/runs/<topic>/`.

The reproduced control failure from the prior complete run is:

```text
write 1: decisions 1-10
write 2: decisions 11-19
write 3: decisions 20-23
write 4: decisions 24-25
```
