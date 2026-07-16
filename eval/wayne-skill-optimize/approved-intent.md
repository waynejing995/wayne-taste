# Approved intent: Wayne Skill Optimize

Optimizing an existing skill preserves its original design capabilities, not just
the current file or the one failure the user happened to report.

Required behavior:

1. Recover original intent from creation commits, pre-optimization skill versions,
   direct resources, commit messages, durable docs/evals, policies, and user
   corrections. Current behavior is evidence, not the sole intent owner.
2. Write an intent-to-oracle coverage matrix before candidate generation. Cover
   output, control flow, state ownership, timing, approval, error, retry, routing,
   dependency, and mutation semantics. Any `UNVERIFIED` row blocks acceptance.
3. Treat a user-reported gap as one seed case, never the coverage boundary.
4. Temporal requirements need transition/event evidence. A correct final file does
   not prove immediate or per-step persistence.
5. Removing a forbidden dependency requires a tested replacement for every
   capability and review type it owned. Deletion alone is regression.
6. Distinguish intended behavior, existing control defects, and incidental
   implementation detail. Candidate must retain intended control passes and fix
   intended behavior the control already violates.
7. Only generate a candidate after the coverage matrix has an executable
   behavioral, static, or script oracle for every required intent row.
