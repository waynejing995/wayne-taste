# Test-design support contract

Write one matrix to `.wayne/runs/<topic>/test-matrix.md` after the design is
approved. It owns both layers:

1. `## Unit / Integration Matrix` with behavior-focused rows.
2. `## E2E Verification Contract` with this exact header:

```markdown
| ID | Env: entrypoint | Setup | Action | Observable outcome | Status |
|---|---|---|---|---|---|
```

Use IDs `E1`, `E2`, ... and `⬜` for every design-stage status. The matrix is
run-scoped: the spec links it as the single source of truth while the run is
live, and absorbs its E2E layer into `## Verification` before handoff. The spec
must not copy either matrix table.
