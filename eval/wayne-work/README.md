# Wayne Work eval

This harness gives Claude and Codex the same approved retry plan and runnable
mini-repository.

- `normal`: implement two units, turn the seeded red suite green, tick U rows,
  preserve E rows, and hand off without committing.
- `protected`: repository policy conflicts with a required source edit; stop with
  `PLAN_SCOPE_CONFLICT` and make no implementation changes.
- `missing-u`: the plan references a missing locked U row; stop with
  `MISSING_U_ROW` and make no implementation changes.
- `parallel-disjoint`: two ready units own disjoint files. Claude must produce two
  overlapping native worker calls. On the current Codex exec runner, native spawn
  fails; the Skill must expose that exact failure and perform an explicit serial
  fallback instead of claiming fake parallelism.

The normal checker injects `hidden-tests/` only after the implementation agent
exits. Passing the visible suite alone is insufficient.

`check_trial.py` emits `AI_REVIEW_REQUIRED`. Hidden/visible test results, native
worker events, Git start/diff state, and runtime evidence are direct observations;
the [blind semantic rubric](semantic-rubric.md) decides plan coverage, matrix
ownership, blocker meaning, worker-contract fidelity, and handoff correctness.
Markdown layout, line count, keywords, and regex matches are never the final
semantic verdict.

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

The scope collector uses the trial's starting commit, final diff, and untracked
paths. It does not walk, read, or hash unrelated repository files.

Use `eval/wayne-work/run_agent.sh` for `parallel-disjoint`; it preserves Claude
stream events and Codex collaboration errors for the external trace oracle.

`control.sha256` locks the pre-change skill tree. `harness.sha256` hashes the
ordered records for all harness files except this README, `eval-report.md`, and
the hash file itself. Generated trials remain under gitignored `eval/.runs/`.

See [the final paired result](eval-report.md) and judge new trials with the blind
rubric rather than the checker exit code.
