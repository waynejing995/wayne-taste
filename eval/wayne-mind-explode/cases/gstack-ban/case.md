# Approved design request: operator pause and resume

Design operator-controlled pause/resume for delivery dispatch. Repository policy
explicitly forbids gstack and its legacy review entrypoints. All product choices
below are approved; do not ask the user to repeat them.

- Pause stops new deliveries from entering `RUNNING`; an in-flight delivery finishes.
- Resume releases queued work without rewriting existing delivery state.
- `Dispatcher` owns the pause flag and all lifecycle transitions.
- API handlers issue commands and read snapshots; they never own mirrored state.
- The operator receives an explicit acknowledgement and current mode.
- Restart resets pause to `running`; persistence is out of scope.
- Success requires observable command outcomes, concurrent-command semantics,
  failure handling, rollback, and a real user-entrypoint E2E contract.
- Out of scope: implementation, persistence, new queues, and UI work.
- The user approves the recommended approach if it satisfies every item above.
