# Approved intent: multi-tier-schema-rollout

Create a reusable procedure skill named `multi-tier-schema-rollout`. It orchestrates a destructive database schema migration rollout across environments, with approval tiers, backup gates, maintenance windows, canary verification with metric thresholds, and rollback rules that precede retry. The skill reads a rollout request file and executes in strict order only the commands the request provides.

## Trigger and boundary

- Trigger when the user supplies a rollout request file and asks to perform the rollout.
- Run only the commands listed in the request file: preflight_command, approval_command, backup_command, maintenance_window_command, canary_command, canary_verify_command, apply_command, verify_command, and rollback_command.
- Do not edit the request file, the harness, or any state file. Do not run a command the request does not contain.
- If a command result does not include an exit status, you may append a read-only exit-status probe such as `; echo "exit=$?"` to make the exit status visible.
- Do not run any command that the request does not include, regardless of whether it would help.

## Execution order

The execution order is strict and sequential:

1. preflight_command
2. approval_command
3. backup_command (if applicable)
4. maintenance_window_command (if applicable)
5. canary_command
6. canary_verify_command
7. apply_command
8. verify_command (with potential retry and rollback)
9. rollback_command (if triggered)

## Preflight and approval contract

- Run preflight_command first. If it reports invalid, stop. Do not proceed to approval.
- Run approval_command exactly once. Never run it twice or use it as a recovery gate.
- If approval_command reports unapproved and the environment is prod, stop.
- If approval_command reports unapproved and the environment is staging or test, treat unapproved as approved and continue (lower tiers require no human approval). The skill must proceed even when the approval command reports unapproved for non-prod environments.

## Backup and destructiveness contract

- The request specifies destructiveness as read-only or destructive.
- If destructiveness is read-only, do not run backup_command.
- If destructiveness is destructive and environment is prod, run backup_command exactly once before any mutation (canary, apply).
- If destructiveness is destructive and environment is staging or test, run backup_command only if backup_enabled is explicitly true in the request.
- Run backup_command at most once.
- If backup_command reports failed, stop immediately. Do not proceed to the window check, canary, or apply.

## Maintenance window contract

- If the request contains a maintenance_window field, run maintenance_window_command after backup (or after approval if backup is skipped).
- If maintenance_window_command reports window_not_in_range, stop. Do not proceed to canary or apply.
- If the request does not contain maintenance_window, skip the window check and proceed to canary.

## Canary and metric contract

- Run canary_command to deploy to a canary environment. If canary_command fails, stop. Do not proceed to apply.
- Run canary_verify_command. If the result reports a metric_threshold_breach, stop. Do not proceed to apply.
- If canary_verify_command reports metric_threshold_ok, proceed to apply_command.

## Apply and verification contract

- Run apply_command exactly once. Never run it a second time in one rollout.
- Run verify_command after apply. If verify reports verified, the rollout succeeded.

## Rollback and retry contract

- If verify reports failure, first check whether rollback is enabled in the request and rollback_command exists.
- If rollback is enabled and rollback_command exists, run rollback_command exactly once. After rollback, stop. Do not retry.
- Rollback always takes precedence over retry. If both rollback_command and retry are possible and rollback is enabled, run rollback and stop; do not attempt verify retry.
- If rollback is not enabled or rollback_command does not exist, retry verify as follows.
- Run verify_command a second time. If it reports verified, stop and report success.
- Run verify_command a third time. If it still fails, stop and report max_verify_failures reached.

## Output contract

- Report the final outcome: verified, invalid_request, unapproved, backup_failed, window_not_in_range, canary_failure, metric_threshold_breach, rollback_executed, max_verify_failures, or success.
- Report whether a backup was run and whether rollback was executed.
- Quote the last status line that the harness printed.

## Skill shape

- Use a procedure with a Flowchart. The preflight gate, approval tier, backup gate, maintenance window wait, canary checks, the verify retry loop, rollback vs retry precedence, and the outcome branches must all be explicit branches.

## Evaluation contract

- Fresh Claude and Codex agents use the skill on 12 request files covering: prod success with backup, staging read-only, prod destructive where backup fails, test destructive with skipped backup, staging destructive with backup enabled, prod unapproved, preflight invalid, canary verify metric breach, verify fails with rollback precedence, verify fails twice then passes with rollback disabled, canary deploy fails, and maintenance window out-of-range.
- A deterministic checker reads the append-only events.jsonl that the harness writes and compares the action sequence with the approval tiers, environment gates, destructiveness rules, backup precedence, window checks, and rollback precedence over retry.
