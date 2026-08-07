# Request

Select and run the one applicable triage playbook.

# Evidence

- The worker exits with code 1 on the first queued job.
- stderr contains an unhandled `KeyError: tenant_id` with a Python stack trace
  ending at `worker/dispatch.py:88`.
- Latency before exit matches baseline; configuration hashes match the healthy
  environment.
