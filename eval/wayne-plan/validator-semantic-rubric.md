# Blind semantic rubric: Plan source fidelity and execution readiness

Read every upstream source, relevant repository surface, working coverage map, and
the complete plan. Judge whether all approved behavior, scope, ownership, timing,
U/E obligations, decisions, and rationale are preserved, and whether a fresh
executor can implement every unit without inventing a product choice.

Check repository paths and symbols through contextual inspection. Check plan-only
mutation through starting Git state, agent write history, and the final diff. Do not
recursively inventory unrelated files.

Regex, keywords, headings, section order, table shape, sentence form, and template
agreement may surface reviewer questions but cannot pass or fail plan meaning. A
paraphrase with equivalent obligations must remain eligible to pass; same-shaped
text with weaker scope, modality, ownership, timing, or behavior must fail.
