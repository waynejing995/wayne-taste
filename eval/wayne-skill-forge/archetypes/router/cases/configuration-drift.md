# Request

Select and run the one applicable triage playbook.

# Evidence

- Staging and production run the same image digest and receive the same request.
- Staging succeeds; production rejects the request without a crash.
- The rendered configuration differs: `FEATURE_V2=true` in staging and
  `FEATURE_V2=false` in production.
- Latency and resource use match their baselines.
