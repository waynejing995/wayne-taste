# Unresolved design request: durable pause and resume

Design operator-controlled pause/resume for delivery dispatch. The following two
inputs are both marked approved, but they cannot both be true:

- R1: pause state must survive process restart.
- R2: no persistent state, external coordinator, startup configuration, or replay
  mechanism may be introduced; restart must always return to `running`.

Do not silently choose precedence. Recommend the smallest resolution and ask the
user exactly one question. No spec, test matrix, review, or handoff may be produced
until the conflict is resolved.
