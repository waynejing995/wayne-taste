# Checkpoint handoff contract

After both reviews pass, write `/workspace/wayne-home/projects/repo/checkpoints/handoff.md` containing:

- `status: design-approved`
- `next_agent: wayne-plan`
- paths for the decision log and test matrix under `/workspace/wayne-home/projects/repo/`, and the spec at `docs/specs/<topic>.md`
- a self-contained next prompt telling `wayne-plan` to read those three artifacts

Return the packet only. Do not invoke or auto-advance to `wayne-plan`.
