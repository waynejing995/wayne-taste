---
name: wayne-mind-explode
description: Converges a feature, system, or architecture idea through repository-grounded questioning into an approved decision log, test matrix, and design spec, then runs two independent design reviews and hands off to wayne-plan. Use for “brainstorm”, “mind explode”, “let's design”, “grill me”, or equivalent Chinese design requests; never use it to implement or write the implementation plan.
---

# Wayne Mind Explode

Turn an unresolved idea into approved design inputs for `wayne-plan`.

## Boundary

Own discovery, decision convergence, design approval, test-design delegation,
conflict resolution, spec writing, independent design review, and handoff. Never
implement code or write an implementation plan. Do not commit, branch, push, or
publish unless separately requested.

Create only design artifacts:

- `docs/decisions/YYYY-MM-DD-<topic>-decisions.md`
- `docs/test-matrix/YYYY-MM-DD-<topic>-test-matrix.md` through `wayne-test-design`
- `docs/specs/YYYY-MM-DD-<topic>-design.md`
- `docs/reviews/YYYY-MM-DD-<topic>-{product|engineering}.md` as immutable evidence
- the handoff packet owned by `wayne-checkpoint`

## Flow

```dot
digraph mind_explode {
    rankdir=TB;
    A [label="Open decision log", shape=box];
    B [label="Research one fact or branch", shape=box];
    P [label="Persist one discovered decision", shape=box];
    C [label="Unresolved decision?", shape=diamond];
    D [label="Ask one recommended question", shape=box];
    Q [label="Persist one user decision", shape=box];
    E [label="Converge and approve design", shape=box];
    F [label="Create test matrix", shape=box];
    G [label="Conflict and legacy review", shape=box];
    H [label="Conflict remains?", shape=diamond];
    I [label="Write spec", shape=box];
    V [label="Written spec approved?", shape=diamond];
    J [label="Run two independent reviews", shape=box];
    K [label="Both pass final revision?", shape=diamond];
    R [label="Revise from findings", shape=box];
    U [label="Review mechanism available?", shape=diamond];
    X [label="Stop: review unavailable", shape=doublecircle];
    L [label="Handoff to wayne-plan", shape=doublecircle];

    A -> B;
    B -> P;
    P -> C;
    C -> D [label="yes"];
    D -> Q;
    Q -> B;
    C -> E [label="no"];
    E -> F;
    F -> G;
    G -> H;
    H -> D [label="yes"];
    H -> I [label="no"];
    I -> V;
    V -> I [label="no: revise"];
    V -> U [label="yes"];
    U -> J [label="yes"];
    U -> X [label="no"];
    J -> K;
    K -> R [label="no"];
    R -> J;
    K -> L [label="yes"];
}
```

## Process

### A. Open decision log

Create the log immediately with `Status: in-progress` and this table:

```markdown
| # | Question | Decision | Rationale | Source |
|---|---|---|---|---|
```

Use source values `user`, `codebase`, `web`, `constraint`, `default`, or `review`.
One file-write event appends exactly one new numbered row. Verify that row is
durable before researching, asking, approving, or handing off; never batch or
reconstruct the log later.

### B. Research project and lessons

Select the next dependency-ordered branch and discover at most one decision before
returning to P. Read repository instructions, relevant code, docs, architecture,
active plans, specs, and recent history. Scan Wayne's KB for semantically matching
lessons, prior decisions, research, how-tos, and project notes; surface matches and
log whether the user applies or skips them. Search the web only when current
external facts could change a design choice, and preserve the source URL in the log.

Answer discoverable questions from those sources. Ask the user only for intent,
priority, risk, or trade-off choices the sources cannot decide.

### P. Persist one discovered decision

Append the single discovered fact or constraint as one new row, verify the durable
file contains it once, then evaluate whether another decision remains. Do not carry
an unlogged fact into the next branch.

### D. Ask one recommended question

Interview the user relentlessly until both sides share the same design. Walk every
branch of the decision tree in dependency order. Ask exactly one question, give
`My recommendation:` and its reason, then wait for the user's answer before moving
on. Look up facts in the environment; put decisions to the user. Log each answer
immediately. Treat `whatever`, `I don't care`, or any non-decision as unresolved:
explain the consequence, repeat one recommendation, and wait. Never infer
precedence between conflicting inputs.

### Q. Persist one user decision

Append only the answered decision as one new row and verify it is durable before
researching or asking the next branch. If the answer did not resolve the choice,
return to D without writing a resolved decision.

### E. Converge and approve design

Only converge after the user confirms shared understanding. Compare 2-3 viable
approaches against the log, lead with the recommendation, and record the choice.
Present architecture, components, state/data ownership, flows, failure behavior,
boundaries, and verification in reviewable sections. Wait for approval of each
material section and log every revision. Do not advance on assumed approval.
Keep units single-purpose with explicit interfaces and dependencies, follow existing
patterns, and exclude unrelated refactors.

Apply a cybernetics lens when the design involves state/lifecycle, a control plane,
multiple readers or writers, streaming, observability, source-of-truth drift,
feedback/retry, or workflow orchestration. Name Plant, Controller, Setpoint,
Disturbance, and Feedback; record only relevant observability, controllability,
ownership, stability, and minimum-control-effort findings. Skip it for a small
single-file pure-logic change with no persistent state or integration.
Give every finding a severity and proposed intervention. Present them one at a time;
the user chooses which interventions apply, and each accepted or declined choice is
logged before test-matrix or spec work.

### F. Create test matrix

After design approval, invoke `wayne-test-design` with the decision log and settled
design. It solely owns the unit/integration matrix and E2E Verification Contract.
All design-stage E statuses remain `⬜`. Record the returned matrix path.

### G. Conflict and legacy review

Re-read all existing plans, specs, architecture, and repository instructions
against the settled design. Route any contradiction to D and repeat this review.
Trace replaced functionality and classify it `Dead`, `Legacy`, or `Shared`; obtain
its direct callers and indirect consumers such as jobs, scripts, APIs, and external
repositories. Obtain and log a user decision for every deletion, deprecation, or
migration. Proceed only with zero unresolved conflicts.

### I. Write spec

Write the approved design to the canonical spec path. Include scope/non-goals,
architecture and ownership, data/control flow, failure and concurrency semantics,
observability, rollback, legacy decisions, and requirement trace. Link the test
matrix as the single source of truth; do not copy either matrix or author a second
E2E contract. Remove every unresolved TBD/TODO before review.

### V. Approve the written spec

Show the canonical spec path and ask the user to approve that exact written
revision. A prior section-by-section approval is not approval of the file bytes.
On rejection, log one decision, revise the spec, and ask again. Start no reviewer
until the written revision is explicitly approved.

### U. Require an independent-review mechanism

Discover the provider-neutral mechanism available to the current agent and
repository for launching isolated reviewers from heterogeneous model families.
Record each reviewer identity. Do not hardcode one agent product's skill names,
tools, or home paths. If two isolated heterogeneous executions cannot be started,
return `REVIEW_UNAVAILABLE` with the missing capability and stop. Never simulate
two voices in one local analysis or silently downgrade to a single review.

### J. Run two independent reviews

Dispatch the same spec revision to two separate reviewer executions:

- product voice: challenge premise, necessity, whether this is the right problem,
  the 10-star alternative, user value, assumptions, scope, and non-goals;
- engineering voice: challenge architecture, ownership, interfaces, data/control
  flow, failures, edge and concurrency paths, tests, performance/capacity,
  observability, rollback, and execution readiness.

Preserve each run as immutable review evidence. The decision log alone owns finding
resolutions and final outcomes; append each outcome as one `review` row. Resolve
findings in the spec, obtain approval of the revised bytes, then rerun both voices.
Both must pass the same final bytes; any later edit makes both passes stale. Never
write review notes into the spec after those passes.

### L. Handoff to wayne-plan

Set the decision log to `Status: design-approved` and link the spec and matrix.
Tell the user their paths and that `wayne-plan` is the next agent. Invoke
`wayne-checkpoint` in handoff mode with those artifacts and `next agent:
wayne-plan`; return the packet without auto-advancing. End here.

## Red lines

- No code, scaffolding, implementation plan, or unrequested commit.
- No question whose answer exists in the repository or approved sources.
- No spec before all required decisions and conflicts are resolved.
- No duplicated E2E contract or second test-matrix owner.
- No claimed dual review without two real executions on the final revision.
