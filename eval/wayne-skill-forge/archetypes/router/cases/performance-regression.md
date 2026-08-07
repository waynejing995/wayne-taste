# Request

Select and run the one applicable triage playbook.

# Evidence

- p95 latency increased from 120 ms to 430 ms and CPU from 42% to 94% under the
  same replay load.
- Throughput fell by 38%; there are no exceptions, exits, or error responses.
- The configuration hash and image digest match the last healthy baseline.
