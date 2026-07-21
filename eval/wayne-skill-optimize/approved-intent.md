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
8. Recover each named status/milestone as a transition contract: precondition,
   setter/owner, allowed next action, forbidden next action, and mutable artifact.
   Record all five fields separately for every milestone; a broad approval or
   no-auto-advance row cannot cover several phase boundaries.
9. Search available Claude and Codex raw histories for the state before a reported
   failure, the user's exact transition phrase, and the first wrong mutation. Record
   an unavailable history as absent; never replace it with a summary.
10. A direct user-observed stochastic failure remains a stability regression when
    one control run passes. Claim a target flip only from a failing control or a
    preserved historical failure trace.
11. Context understanding belongs to independent AI source-fidelity review.
    Deterministic checkers may validate only low-freedom structure, hashes,
    literals, IDs, closure, mutations, and event order. Heading/ID/keyword/
    substring/regex heuristics must never claim semantic classification,
    completeness, equivalence, intent recovery, or causality.
12. Freeze two boundary cases for this split: equivalent meaning under an
    unexpected heading must pass contextual review; same-shaped text with weakened
    scope, owner, modality, or timing must fail even when lexical checks agree.
