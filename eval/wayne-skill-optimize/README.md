# Wayne Skill Optimize eval

This meta-eval gives the optimizer a two-commit mock skill whose current prose has
already lost behaviors from its initial design. The only user feedback mentions
delayed decision logging; a repository policy separately forbids the review addon
used by the initial version.

The optimizer must recover the complete intent from git history, current files,
policy, and feedback before drafting a candidate. It prepares only a frozen dossier
and exact cases under `eval/decision-builder/`.

```bash
uv run --no-project python eval/wayne-skill-optimize/calibrate.py
bash eval/wayne-skill-optimize/prepare_trial.sh wayne-skill-optimize \
  eval/.runs/wayne-skill-optimize/control-claude
```

`harness.sha256` hashes the ordered `sha256sum` records for `approved-intent.md`,
the two checker/calibration scripts, `control.sha256`, `fixture/*`,
`prepare_trial.sh`, and `task.md`. Generated runs, this README, and the result
report are excluded.

See [the final A/B result](eval-report.md).
