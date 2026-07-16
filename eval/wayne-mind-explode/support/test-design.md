# Test-design support contract

Write one matrix to `docs/test-matrix/YYYY-MM-DD-<topic>-test-matrix.md` after the
design is approved. It owns both layers:

1. `## Unit / Integration Matrix` with behavior-focused rows.
2. `## E2E Verification Contract` with this exact header:

```markdown
| ID | Env: entrypoint | Setup | Action | Observable outcome | Status |
|---|---|---|---|---|---|
```

Use IDs `E1`, `E2`, ... and `⬜` for every design-stage status. The spec links this
file as the single source of truth; it must not copy either matrix.
