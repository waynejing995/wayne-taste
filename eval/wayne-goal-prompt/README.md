# Wayne Goal Prompt eval

This harness compares one frozen `wayne-goal-prompt` control with one candidate.
Generated workspaces, homes, traces, fake app-server state, and candidates belong
under `eval/.runs/wayne-goal-prompt/`.

Behavior lanes:

- `vague-missing`: missing target and acceptance evidence must produce one pointed
  Chinese question, not invented criteria or dispatch.
- `compose-real-path`: a complete raw request becomes a bounded six-section goal
  with exact commands, real entrypoint proof, and a confirm gate.
- `existing-plan`: the prompt references the plan SSoT without copying its body,
  while keeping verification and completion self-contained.
- deterministic dispatch: a fake app-server proves initialize failure,
  `turn/start` failure before readiness, and same-thread blocked/resume behavior
  without provider noise.

Run every composition case with Claude-primary and Codex-primary. Run bundled
scripts plus dispatch protocol checks directly. Infrastructure termination before
an observable artifact is `invalid`, not a behavioral loss.

## Current mechanical gates

```bash
uv run --no-project python eval/wayne-goal-prompt/calibrate_candidate_static.py <candidate-skill>
uv run --no-project python eval/wayne-goal-prompt/calibrate_dispatch.py
uv run --no-project python eval/wayne-goal-prompt/check_dispatch.py <candidate-skill>
uv run wayne-skill-forge/scripts/validate_skill.py <candidate-skill>
```

These gates cover loader metadata and the real dispatch protocol only. Composition
artifacts are AI-readable Markdown; `calibrate.py`, `calibrate_validator.py`,
`check_trial.py`, and `check_candidate_static.py` are retained as historical
observation fixtures until the harness is migrated. Their heading, phrase, count,
and regex findings cannot independently pass or fail goal meaning.

`prepare_trial.sh` and `run_agent.sh` own paired provider runs. A blind AI judge
must read task, sources, goal, and observations before deciding behavior.
The runner exposes only the named `/workspace/skill` snapshot; Claude receives an
isolated home so prior transcripts and installed skills cannot replace the trial.
See `eval-report.md` for the accepted control/candidate result.
