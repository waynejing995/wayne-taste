# Request

Select and run the applicable incident investigation playbook.

# Evidence

- Alert triggered at 16:42 UTC: Error rate jumped within 2 minutes.
- Error rate: 6.1% (baseline: 0.3%).
- Log analysis: 87% of errors are HTTP 503 from downstream dependency failures.
- p95 latency: 395ms (baseline: 400ms, SLO: 500ms).
- Memory utilization: 51%.
- CPU utilization: 45%.
- Disk free space: 22% of partition.
- Application version unchanged for 4 days; no deployment in last 24 hours.
