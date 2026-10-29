# Eval repository rules

- Do not edit product files or input artifacts.
- Checkpoint state belongs only in the project state directory that `/workspace/_shared/scripts/wayne-state-dir.sh` prints; the repository receives none.
- A handoff is return-only and never invokes its consumer.
- Do not commit, branch, push, publish, or access the network.
