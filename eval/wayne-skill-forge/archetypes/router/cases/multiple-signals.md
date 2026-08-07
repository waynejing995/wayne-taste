# Request

Select and run the one applicable triage playbook.

# Evidence

- The process exits with an unhandled stack trace in `worker/dispatch.py`.
- The same image succeeds in staging and fails in production.
- Rendered configuration also differs: `QUEUE_MODE=batch` in staging and
  `QUEUE_MODE=stream` in production.
- There is not yet an experiment that separates the crash signal from the
  configuration-drift signal.
