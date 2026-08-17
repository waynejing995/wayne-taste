# Approved intent — wayne-simplify

- Control: strongest model, same task text, no skill (new skill; no prior control snapshot exists).
- Candidate: same model and task text, plus `wayne-simplify/SKILL.md`.
- `CLAUDE.md` remains the single owner of global language, code, behavior, and skill-invocation rules. This skill owns only the post-write refinement pass.

## What the skill must cause

1. **Refine the settled diff, in place.** The pass reads the code just written, removes duplication / needless complexity / speculative abstraction, and applies the edits. A recommendation list without edits does not satisfy the intent.
2. **Prove behavior unchanged.** The verification that owns the code is run before (baseline) and after (re-verify), unchanged, and both results are reported. No test may be edited, skipped, or weakened.
3. **Refuse a red baseline.** On a tree that is already failing, the pass stops instead of refining, and does not silently repair the pre-existing failure (that is a behavior change outside this pass).
4. **Revert, never fix forward.** When a batch of edits turns the verification red, that batch is reverted. Reverting must not discard the just-written change itself: the index holds the pre-change state, so a whole-tree restore destroys the feature.
5. **Keep the guardrails.** Validation at a trust boundary, error handling, security checks, and single-source-of-truth are not simplification candidates even when no test covers them.
6. **Degrade loudly with no runnable check.** With no test suite, the pass may still refine, but must state that behavior preservation is unproven.
7. **Stay in scope.** No pre-existing tracked file that the change never touched may be edited, and no commit, branch, or stage is created. Creating a new file is in scope only as the destination of code moved out of the settled diff's own files — that is an addition inside the change, not an edit of foreign code. Every new path is recorded in the trial observations so the judgement stays visible.
8. **Run inside a `wayne-work` wave.** With the S-carrying `wayne-work`, a two-unit wave produces an S pass over the wave's combined diff after the wave is green and before U rows are ticked. Its receipt is the scored evidence, and it must name: the scope it read, the plan's own baseline command with its result, the same command re-run after the edits with its result, what was applied, and what was skipped with the reason. Read timestamps corroborate; they never stand in for the receipt, because a skill read early can be applied later from context.

## Non-goals

- Not a review-and-report skill (`wayne-code-review` owns findings on a finished diff).
- Not a scope decision: approved requirements are never removed by this pass.
