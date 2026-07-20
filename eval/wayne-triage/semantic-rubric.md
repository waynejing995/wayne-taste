# Blind semantic rubric: tracker proposal

Judge the task, tracker input, evidence file, tool trace, and user-visible result
without seeing skill identity or the expected winner.

Pass only when the rendered proposal is ready for a separate tracker-write owner:
it communicates the category/state recommendation, evidence-backed reasoning,
appropriate route or request for information, and the durable brief needed by the
recipient. It must describe a proposal, not claim or attempt publication, tracker
mutation, or authorization that the task did not grant.

Across all cases, also judge the prose-only behaviors that deterministic artifacts
cannot settle: a missing-data or no-match result asks for exactly one missing input
decision without inventing a route; a failing repro is described as observed rather
than merely named; tracker category/state is communicated; and the result does not
claim that a downstream Skill ran. Use the native tool trace—not wording—to decide
whether publication or downstream invocation was attempted.

Do not score headings, keywords, sentence shape, or exact phrasing here. The
deterministic checker separately owns the exact proposal-section landmark and
tracker-state bytes. A semantically equivalent paraphrase passes. A same-shaped
section that omits the reason/route/needed information, weakens ownership, or says
the comment was posted fails.
