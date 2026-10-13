# Request

Select and run the applicable incident investigation playbook.

# Evidence

- Incident start detected: 11:03 UTC (based on observed metric elevation).
- Alert triggered: 11:08 UTC.
- p95 latency: 420ms (baseline: 400ms, SLO: 500ms).
- Error rate: 0.5% (baseline: 0.3%).
- CPU utilization: 42%.
- Memory utilization: 48%.
- Disk free space: 28GB of 40GB.
- Configuration deployment: `CACHE_TTL` changed from 3600s to 1800s at 11:00 UTC.
- No application code deployment or restart.
