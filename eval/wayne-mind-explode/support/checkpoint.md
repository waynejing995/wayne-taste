# Checkpoint handoff contract

After both reviews pass, write `.wayne/checkpoints/handoff.md` containing:

- `status: design-approved`
- `next_agent: wayne-plan`
- repository-relative paths for the decision log, spec, and test matrix
- a self-contained next prompt telling `wayne-plan` to read those three artifacts

Return the packet only. Do not invoke or auto-advance to `wayne-plan`.
