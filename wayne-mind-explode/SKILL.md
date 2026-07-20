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

`decision locked`, `design approved`, or an equivalent milestone freezes design
state; it never authorizes execution. Continue only this Flow, hand off to
`wayne-plan`, and stop. Never execute the plan or invoke `wayne-work`.

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
    C [label="Next DAG node?", shape=diamond];
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
    C -> B [label="fact"];
    C -> D [label="choice"];
    D -> Q;
    Q -> C;
    C -> E [label="empty"];
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

Read `_shared/pipeline-id-contract.md` completely. Create the log immediately with
`Status: in-progress` and this table:

```markdown
| ID | Question | Decision | Rationale | Source |
|---|---|---|---|---|
| D1 | ... | ... | ... | user |
```

The same file also owns the complete decision frontier:

```markdown
## Decision DAG
| Node | Parent | Kind | Decision | Status | Opens when |
|---|---|---|---|---|---|
```

Use stable dependency-ordered node IDs. `Kind` is `fact` or `choice`; `Status` is
`blocked`, `open`, `resolved`, or `not-applicable`; put only that literal in the
status cell. `Decision` names the unresolved fact or choice and is never blank or
`—`; `Opens when` contains only its activation predicate. Preserve supplied node
boundaries and dependencies: one turn processes one node, and one answer never
batch-resolves split nodes. Seed known roots and dependents as `open` or `blocked`,
then add children as their parent resolves.

Use source values `user`, `codebase`, `web`, `constraint`, `default`, or `review`.
Assign the next `D<number>` without leading zeroes. Review reports use `F<number>`;
never reuse `R<number>`, which is reserved for requirements.
One file-write event appends exactly one new numbered row. Verify that row is
durable before researching, asking, approving, or handing off; never batch or
reconstruct the log later.

### B. Research project and lessons

On the initial pass, research enough to seed known root and dependent nodes. Then
select the next reachable open `fact` and process at most one before returning to P.
Read repository instructions, relevant code, docs, architecture,
active plans, specs, and recent history. Scan Wayne's KB for semantically matching
lessons, prior decisions, research, how-tos, and project notes; surface matches and
log whether the user applies or skips them. Search the web only when current
external facts could change a design choice, and preserve the source URL in the log.

An evidence-backed `fact` auto-resolves without user confirmation; append its
numbered evidence row before marking it resolved. Never seed a fact as resolved.
Every design-relevant source fact belongs in both the numbered log and the DAG;
never leave it only in a prose context, notes, or summary section.
A `choice` requires the user when it concerns intent, priority, risk, scope, or a
trade-off. Ambiguous or conflicting evidence cannot resolve a fact: keep the node
open and route it as a choice.

After every resolved node, expand consequences before choosing the next node: what
new purpose/scope, owner, interface, data/control flow, failure/concurrency,
compatibility, operations, verification, or rollback decision becomes reachable?
Persist each real child. A broad parent answer never resolves its consequences.

### P. Persist one discovered decision

Append the single discovered fact or constraint as one new row. In that same write,
mark its node resolved and persist every child it opened as `open` or `blocked`;
verify both row and frontier before selecting another node. Do not carry an unlogged
fact or unpersisted child into the next branch.

### D. Ask one recommended question

Interview the user relentlessly until both sides share the same design. Select the
next reachable open `choice` from the durable DAG. Ask exactly one question and
offer three concrete options for that decision, with `My recommendation:` naming
the option you would choose and why. For a genuinely binary decision, offer two
and state why no third distinct option exists; never pad the list with a fake
variant. Then wait for the user's answer before moving on. One question means one
open decision node; punctuation, sentence count, and whether the options are
phrased interrogatively do not define cardinality. Never repeat the same decision
as a second question in a heading or closing. Look up facts in the environment;
put decisions to the user. Log each answer immediately. Treat `whatever`, `I don't
care`, or any non-decision as unresolved: explain the consequence, repeat one
recommendation, and wait. Never infer precedence between conflicting inputs.

The recommendation is advice, never a default or a disguised approval request.
Ground all options in current evidence and decisions. For the recommendation name
its key assumption and reversal condition; for each alternative name its distinct
advantage or trade-off. Ask for the user's choice neutrally; silence, agreement
with the framing, or acceptance of a parent node never approves this node or its
children.

### Q. Persist one user decision

Append only the answered decision as one new row and verify it is durable before
researching or asking the next branch. In the same write, mark that node resolved
and persist all children opened by the answer. If the answer did not resolve the
choice, leave it open and return to D without writing a resolved decision.

### E. Converge and approve design

Converge only when every DAG node is `resolved` or `not-applicable` and a coverage
audit finds no missing branch across purpose, scope, ownership, interfaces,
data/control flow, failure/concurrency, observability, verification, rollback, and
legacy impact. Decision count, turn count, context length, or an apparently complete
summary never empties the frontier; 40+ resolved decisions with one open node must
continue. Grilling has no question cap; only the user may explicitly stop or request
a partial wrap-up. After the user confirms shared understanding, compare three
genuinely distinct viable approaches against the log, lead with the recommendation,
and record the choice. If the approved constraints leave only two viable approaches,
state the eliminated third direction and why it is not viable instead of padding it.
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
