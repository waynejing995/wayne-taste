# Checkpoint support contract

For an approved complete route, write `.wayne/checkpoints/handoff.md` with:

- `status: triaged`
- `next_agent: <the stage selected by the route>`
- `snapshot: <repo-relative evidence-file path>`
- `route: <verdict>`
- a behavioral next prompt with acceptance criteria and explicit out-of-scope

Return the packet only. Do not auto-run the next stage. `needs-info` has no handoff.
