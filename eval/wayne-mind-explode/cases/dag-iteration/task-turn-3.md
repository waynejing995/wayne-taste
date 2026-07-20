Continue the existing design workflow using its durable decision state. The user
answers the pending question: use at-least-once delivery; `Dispatcher` owns
idempotency and duplicate suppression. Record only that answer, expand any decisions
it opens, ask exactly one next recommended question, and stop. Do not infer approval
of remaining choices or create a spec, matrix, review, handoff, implementation,
plan, commit, branch, or push.
