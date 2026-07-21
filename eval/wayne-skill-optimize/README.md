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

Use `eval/wayne-skill-optimize/control/` for the frozen control and the live
`wayne-skill-optimize/` directory for the candidate. After each author trial passes
the deterministic dossier gate, prepare fresh neutral Claude and Codex review
workspaces with `prepare_review.sh`; install neither report until its JSON and
provider run completed normally.

`harness.sha256` hashes the ordered `sha256sum` records for `approved-intent.md`,
the checker/calibration scripts, `dossier-contract.md`, `control.sha256`,
the control snapshot, `fixture/`, author/review preparation scripts, review task,
and `task.md`. Generated runs, this README, and the result report are excluded.

The deterministic checker proves only dossier integrity: source hashes and exact
excerpts, JSON closure, executable positive/mutation oracles, file boundaries, and
review-report hashes. Claude and Codex source-fidelity reviews own semantic intent
completeness and classification. No heading, keyword, substring, or regex result is
accepted as semantic evidence.

Reviewer read-only proof hashes only `eval/<target>/`, whose files the evaluator
owns, and freezes Git HEAD/status/diff for the repository. It never walks or opens
unrelated repository contents or requires permission repair outside the dossier.

Freeze the harness from the repository root with:

```bash
bash eval/wayne-skill-optimize/freeze_harness.sh
```

See [the final A/B result](eval-report.md).
