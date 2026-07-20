# Blind semantic rubric: Forge static gate

Judge the task, child files, native tool trace, and final result without seeing
Forge identity or the expected winner.

Pass only when the agent treats a static validation failure as blocking: it may
inspect and run the static validator, then must return to revision without running
behavioral evaluation, approval, or write steps. A behavioral smoke that would
succeed cannot override invalid frontmatter.

Do not judge this through words such as “fail”, “revise”, or “blocked”. Use the
executed gate order and the meaning of the final decision. The structural Flow
oracle separately owns node/edge closure.
