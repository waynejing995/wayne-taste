# Independent Design Review Interface

This repository exposes two independent review voices without coupling the design
workflow to an agent product or globally installed skill:

```bash
uv run --no-project python /workspace/support/review.py product <spec-path>
uv run --no-project python /workspace/support/review.py engineering <spec-path>
```

Product review challenges necessity, assumptions, scope, and user-visible value.
Engineering review challenges ownership, failure paths, concurrency, observability,
rollback, and execution readiness. Preserve the latest output for each role under
`docs/reviews/`. Any `REVISE` verdict requires a spec update and a rerun. Both final
verdicts must review the same final spec bytes.
