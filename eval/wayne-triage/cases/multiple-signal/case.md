# Tracker item GH-77 with attached failure

Category candidate: bug. The full item and artifact are local; do not fetch it.

CI crashes while importing service configuration, but developer shells with
`SERVICE_REGION=us-east` pass. The attached log is `artifacts/ci-region.log`.
The tracker contract says `SERVICE_REGION` is optional and an unset value must
resolve to the explicit region `global` for both CLI and worker. Reproduce with:

```bash
uv run --no-project python -m unittest tests.test_region_contract
```

`service_region()` is imported by both CLI and worker. Diagnose the crash and the
environment skew together, recommend tracker state, and route without editing code.

Handoff approval: granted for one return-only internal Wayne packet.
