# Dispatch runtime contract

The bundled scripts own Codex app-server transport. The skill body owns when to
dispatch; this reference owns how to operate and diagnose the runtime.

## Public commands

```bash
S=<wayne-goal-prompt>/scripts/codex-dispatch.sh
JOB=$($S dispatch <project>/goal-<slug>.md <project>)
$S status "$JOB"
$S tail "$JOB" '>>> UNIT|"type":"error"|"type":"turn.failed"'
$S inject "$JOB" '<text|@file>'
$S resume "$JOB"
$S list
```

`dispatch` creates one workspace-namespaced job, event log, driver log, inbox,
control directory, and metadata record. It emits the job ID only after the driver
has completed `initialize`, `thread/start`, and initial `thread/goal/set`. A startup
failure returns non-zero and preserves the job directory and exact driver reason.

## Protocol invariants

The Python driver is the only app-server protocol owner:

- start with `sandbox: danger-full-access` and `approvalPolicy: never`;
- set the objective with `thread/goal/set`;
- start work with `turn/start` whose `input` is an item array;
- inject reviewer messages with the literal method `thread/inject_items`;
- mirror every sent/received frame to JSONL;
- accept completion only from `thread/goal/updated` with status `complete`.

Do not copy these method/shape details into the skill body or a generated goal.

## State transitions

| Observed state | Driver action | Operator action |
|---|---|---|
| `active` | keep the app-server and thread alive | monitor JSONL |
| `paused` / `blocked` | retain the same process/thread and record the state | fix the external cause, then `resume JOB` once |
| `usageLimited` / `budgetLimited` | record non-complete and exit 2 | report the limit; do not resume-spam |
| `complete` | record complete and exit 0 | report completion evidence |
| provider/app-server death | record failure and exit non-zero | preserve logs; dispatch a new job only after the cause changes |

`resume` signals the already-running driver. The driver sends
`thread/goal/set {threadId, status:"active"}` for the same thread ID. It does not
launch another driver, create another job, or use a bare off-loop turn.

## Monitoring and injection

The JSONL log is the push source. Gate on structured event methods/types and the
worker's own unit marker; a bare word may appear inside echoed file content and is
not an event. `inject JOB @file` writes a message to the job inbox; the live driver
delivers it with `thread/inject_items` and marks it sent.

Do not use tmux/rmux, `send-keys`, `capture-pane`, or a polling status loop. Do not
kill a live driver to “restart clean.”
