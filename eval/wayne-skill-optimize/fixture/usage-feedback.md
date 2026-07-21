# Usage feedback

The latest run asked good questions, but it wrote the decision log only once at the
end. I expected each answered decision to be durable before the next question.
The raw Claude and Codex turns are under `session-history/`; recover the exact state,
user phrase, and first mutation instead of relying only on this summary.
Also inspect the evaluator itself: a previous optimizer used heading and regex
matching to decide whether intent was complete. Treat that as a hard evaluator
defect. Contextual source review must own meaning; scripts may check only
low-freedom structure and recorded events.
