# Request

Select and run the applicable incident investigation playbook.

# Evidence

- Alert triggered at 15:30 UTC: both latency and error rate elevated.
- p95 latency: 1850ms (baseline: 400ms).
- p99 latency: 3200ms (baseline: 600ms).
- Error rate: 7.2% (baseline: 0.3%), jumped within 2 minutes of 15:28 UTC.
- Log query: 82% of errors are upstream timeout exceptions since 15:28 UTC; no application restarts in this window.
- Memory utilization: 52%.
- CPU utilization: 48%.
- Disk free space: 32GB of 50GB.
- No application deployment or configuration change in past 48 hours.
