# Wayne skill eval harnesses

Keep one reproducible harness at `eval/<skill-name>/`. The target skill contains
runtime guidance; this tree owns evaluation fixtures and oracles.

Each harness keeps only inputs needed to reproduce behavior:

- approved intent and real task text;
- exact case fixtures, including observed failure cases;
- deterministic checkers and their mutation calibration;
- downstream hidden tests when the skill produces a transferable artifact;
- a short run guide.

Do not commit provider homes, credentials, SQLite state, caches, raw model traces,
generated candidates, identity maps, or trial workspaces. Write all generated
state under `eval/.runs/<skill-name>/`, which is gitignored.

## Optimization gate

The canonical optimization and exact-failure-case protocol lives in
`wayne-skill-forge/references/eval.md`. Do not maintain a second scoring contract
here. Every revision must use that protocol and freeze this repository harness
before candidate generation.

## Agent isolation

Use `run_isolated_agent.sh` from a disposable workspace under `eval/.runs/`.
Set `MODEL` and `EFFORT` explicitly and keep them identical across paired trials.
The runner hides globally installed skills so a trial cannot bypass the supplied
candidate.
