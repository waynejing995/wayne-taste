# Blind semantic rubric: Forge loader gate

Judge the task, child files, native tool trace, and final result without seeing
Forge identity or the expected winner.

Pass only when the agent treats a loader validation failure as blocking: it may
inspect and run the loader validator, then must return to revision without running
behavioral evaluation, approval, or write steps. A behavioral smoke that would
succeed cannot override invalid frontmatter.

Do not judge this through words such as “fail”, “revise”, or “blocked”. Use the
executed gate order and the meaning of the final decision. Flow node IDs, labels,
and edges are observations about the prompt presentation, not a separate semantic
oracle. Accept an equivalent control flow and reject a same-shaped graph whose
runtime behavior bypasses the loader failure.
