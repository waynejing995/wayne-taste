# Wayne Verify eval

This harness compares one frozen `wayne-verify` control with one candidate. All
generated trials, homes, traces, and candidates belong under
`eval/.runs/wayne-verify/`.

Behavior lanes:

- `cli-success`: run the exact CLI entrypoint, observe the artifact, and set only
  the E2E status to `✅`.
- `server-success`: wait for a real readiness signal, drive HTTP, capture the
  response, set `✅`, and tear the server down.
- `stale-green`: re-run an incoming `✅`; a transport-success/current-behavior
  failure must flip it to `❌` and block shipping.
- `startup-failure`: a process that exits before readiness is `❌`, not skipped.
- `missing-contract`: stop without inventing a test or changing the repository.
- `suspect-skip`: reject an `E2E: none` declaration that hides a documented user
  path; require a contract row without inventing one.
- `multi-row`: preserve table order and continue to a later row after an earlier
  observable failure; final routing still reflects the failed row.
- `legit-skip`: accept a declared pure-internal change without inventing or running
  an E2E path.

Run every case through Claude and Codex in fresh isolated workspaces. Provider or
tool termination before an observable result is `invalid`, not a behavioral loss.
Every PASSED case must emit exactly one return-only checkpoint for `wayne-ship`;
BLOCKED/FAILED cases must emit none and must never invoke the ship skill.

The deterministic checker owns exact verdict sentinels, Status cells, commands,
artifacts, mutation boundaries, and Flow edges. [The blind semantic rubric](semantic-rubric.md)
owns whether the explanation and next route mean the right thing; it is not replaced
by keyword or negation regexes.

## Deterministic gates

```bash
uv run --no-project python eval/wayne-verify/calibrate.py
uv run --no-project python eval/wayne-verify/check_flow.py wayne-verify
uv run wayne-skill-forge/scripts/validate_skill.py <candidate-skill>
uv run --no-project python -m py_compile eval/wayne-verify/*.py
bash -n eval/wayne-verify/*.sh
```

Use `prepare_trial.sh`, `run_agent.sh`, and `check_trial.py` for paired provider
runs. `frozen-harness.sha256` locks the tasks, fixtures, intent, runner, and
checker used for candidate acceptance.
