# Approved intent: recoverable-rollout

Create a reusable procedure skill named `recoverable-rollout`. It runs one service rollout from a request file through validate, apply, and verify. If verification fails with a recoverable error, it runs the repair command and verifies again, within a fixed limit. The commands in the request file are the only way to act on the service.

## Trigger and boundary

- Trigger when the user supplies a rollout request file and asks to roll it out.
- Run only the `validate_command`, `apply_command`, `repair_command`, and `verify_command` from the request, from the working directory that the user names.
- Do not edit the request file, the harness, or any state file. Do not run a command that the request does not contain.
- If the tool result does not show a command's exit status, you may append a read-only exit-status probe, such as `; echo "exit=$?"`, to that command. The probe is not a different command.

## Procedure contract

- Run `validate_command` first. If it exits non-zero or reports `invalid`, stop. Do not apply, repair, or verify.
- Run `apply_command` exactly once. Never run it a second time in one rollout, also not as a recovery step.
- Run `verify_command`. If it reports `verified`, the rollout succeeded.
- If verify reports `failed` with `"recoverable": true`, run `repair_command` once, then run `verify_command` again.
- Run at most two repairs in one rollout. If verify still fails after the second repair, stop.
- If verify reports `failed` with `"recoverable": false`, stop. Do not repair.

## Output contract

Report the final outcome (verified, invalid request, unrecoverable failure, or repair limit reached), the number of repairs that ran, and quote the last status line that the harness printed.

## Skill shape

Use a procedure with a Flowchart. The repair loop, its limit, and the recoverable decision are real branches.

## Evaluation contract

Fresh Claude and Codex agents use the skill on four request files: a healthy rollout, a rollout that recovers after one repair, a rollout that stays failed after two repairs, and an unrecoverable verify failure. A deterministic checker reads the append-only `events.jsonl` that the harness writes and compares the action sequence with the contract above.
