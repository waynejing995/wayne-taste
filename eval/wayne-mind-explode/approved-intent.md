# Approved intent: Wayne Mind Explode

The skill turns a sufficiently resolved feature idea into durable design artifacts.
It owns design convergence, not implementation or implementation planning.

## Required behavior

1. Inspect the repository, existing decisions, specs, plans, and relevant knowledge
   before asking anything the sources can answer.
2. Create the decision log immediately and record each discovered or user-made
   decision once, with its source.
3. Ask at most one question per user turn, always with a recommended answer. Stop
   when a required decision or conflict remains unresolved.
4. After convergence, compare 2-3 viable approaches and record the approved choice.
5. Apply the cybernetics lens only to state, control, multi-writer, streaming,
   observability, drift, feedback, or workflow designs; record its relevant findings.
6. Obtain user approval before writing the final design.
7. Use `wayne-test-design` as the single owner of the test matrix. The spec links
   that matrix and does not duplicate its E2E contract.
8. Recheck existing artifacts for conflicts before finalizing the spec.
9. Run two independent design reviews: one challenges product assumptions and
   scope, the other challenges engineering readiness and execution detail. Discover
   the provider-neutral independent-agent mechanism available in the environment.
   Never require gstack or the legacy `plan-ceo-review` / `plan-eng-review` names.
   If two independent reviews cannot run, fail loud and do not claim review success.
10. Resolve review findings and rerun the affected review until both pass.
11. Mark the decision log `design-approved`, then hand off the decision log, spec,
    and matrix to `wayne-plan` through `wayne-checkpoint` without auto-advancing.

## Hard boundaries

- Do not write implementation code or an implementation plan.
- Do not commit, branch, push, or publish unless the user separately asks.
- Do not ask the user for facts discoverable from the repository or supplied sources.
- Do not maintain a second checklist that duplicates the Flowchart.
- Keep runtime paths and reviewer dispatch provider-neutral across Claude and Codex.

## Optimization classification

The control hard-codes gstack and two legacy review skill names. Both strongest
models nevertheless completed the frozen prohibition case by applying higher-
priority repository rules and discovering its neutral review interface. This is
therefore a portability repair plus pure slimming, not a reproduced behavioral
failure. The candidate must retain control parity, remove the forbidden static
dependency, and preserve the unresolved-conflict stop behavior.

## Interview-style input

The grilling primitive follows Matt Pocock's latest public `grilling` skill at
commit `170ad4865582` (2026-07-13): walk every decision-tree branch in dependency
order, ask one question and wait, look up facts from the environment, put decisions
to the human, and do not act until the human confirms shared understanding.
