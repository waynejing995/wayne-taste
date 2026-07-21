# Wayne Test Design eval

Frozen generator eval for provider isolation, one-proof-axis decomposition,
missing native capability evidence, simple no-bloat behavior, and absorption of an
existing E2E draft. It also carries a calibrated static regression guard for the
historical routing, ownership, filename, runtime-location, and nested-caller intent.
Generated state lives under `eval/.runs/wayne-test-design/`.

Each Claude/Codex trial receives one isolated skill snapshot and approved spec and
writes only `docs/test-matrix/matrix.md`. `check_trial.py` emits
`AI_REVIEW_REQUIRED`; its observations feed the
[blind matrix rubric](semantic-rubric.md). Headings, table shape, columns, Flow
labels, and lexical matches cannot decide matrix or skill meaning.

The paired provider settings are Claude Opus 4.8 / high and
`dvue-aoai-001-gpt-5.6-sol` / high. Provider/tool termination before a matrix exists
is invalid, not a behavioral failure.

## Evidence

```bash
uv run --no-project python eval/wayne-test-design/calibrate.py
uv run --no-project python eval/wayne-test-design/check_candidate_static.py \
  eval/.runs/wayne-test-design/candidate/wayne-test-design
uv run wayne-skill-forge/scripts/validate_skill.py \
  eval/.runs/wayne-test-design/candidate/wayne-test-design
```

The loader/resource check hard-fails only when the candidate skill or its template
is missing. The previous static wording/Flow mutation checker was removed because
equivalent current wording produced false “missing intent” findings. Matrix-content
scans remain observations for the blind reviewer, not pass/fail oracles. Git status
remains direct scope evidence.

For each case and lane, create a fresh workspace with `prepare_trial.sh`, run Claude
and Codex separately with `run_agent.sh`, then give the task, sources, matrix, and
checker observations to a blind AI reviewer using `semantic-rubric.md`. Never reuse a workspace, state
directory, or output from an invalidated harness revision.
