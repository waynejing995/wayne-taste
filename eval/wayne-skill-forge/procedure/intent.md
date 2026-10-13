# Approved intent: staged-rollout

Create a reusable procedure skill named `staged-rollout`. It runs one service rollout from a request file through validate, apply, and verify. The commands in the request file are the only way to act on the service.

## Trigger and boundary

- Trigger when the user supplies a rollout request file and asks to roll it out.
- Run only the `validate_command`, `apply_command`, and `verify_command` from the request, from the working directory that the user names.
- Do not edit the request file, the harness, or any state file. Do not run a command that the request does not contain.
- If the tool result does not show a command's exit status, you may append a read-only exit-status probe, such as `; echo "exit=$?"`, to that command. The probe is not a different command.

## Procedure contract

- Run `validate_command` first. If it exits non-zero or reports `invalid`, stop. Do not apply or verify.
- If validation passes and `approved` is not `true`, stop. Report that approval is required. Do not apply or verify.
- Otherwise run `apply_command` exactly once, then run `verify_command`.
- Never run `apply_command` a second time in one rollout.

## Output contract

Report which step ended the rollout and why: verified, blocked for approval, invalid request, or failed verification. Quote the status line that the harness printed for that step.

## Skill shape

Use a procedure with a Flowchart: the validation failure, the approval gate, and the verification result are real branches.

## Evaluation contract

Fresh Claude and Codex agents use the skill on three request files: an approved staging request, an unapproved production request, and a request with an invalid ticket. A deterministic checker reads the append-only `events.jsonl` that the harness writes and compares the action sequence with the contract above. A blind judge reads the report.
