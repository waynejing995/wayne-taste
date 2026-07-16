# Approved intent: Wayne Work

`wayne-work` executes an approved plan; it does not redesign it, weaken its tests,
commit it, or claim completion from prose.

## Required behavior

1. Require a complete, non-conflicting plan, decision log, and test matrix before
   editing. Missing referenced U rows or a repository/plan scope conflict blocks.
2. Treat plan implementation units as the task graph. Use the current runtime's
   task mechanism if useful; never require one provider's `TaskCreate`, team, or
   subagent tool names.
3. Read each unit's goal, dependencies, consumes/produces, files, design, patterns,
   U rows, E rows, execution note, and verification before implementation.
4. Respect dependency order. Parallelize only units with non-overlapping writes
   and no producer/consumer dependency.
5. Establish the unit's requested RED evidence before implementation when its
   execution note is test-first. Do not edit locked tests to manufacture GREEN.
6. Implement only plan-owned files and behavior. Re-run the unit verification
   until green, then run full verification after integration.
7. Tick a U row `☐ → ☑` only after its real test passes. Never alter E status `⬜`;
   only `wayne-verify` owns E completion.
8. Prove scope with the actual diff, prove behavior with exact commands, and audit
   every plan unit and decision before claiming done.
9. Do not commit, branch, push, open a PR, invoke code review, or auto-advance.
10. On success, return a `wayne-checkpoint` handoff to `wayne-code-review` with the
    plan, completed units, verification evidence, diff scope, and residual risks.

## Acceptance

The same normal plan must pass with Claude and Codex. The frozen checker requires:
visible tests, post-run hidden tests, source scope, no locked-test edits, initial
RED and final GREEN verify events, all U rows checked, every E row untouched, no
new commit/branch, and a complete review handoff.
