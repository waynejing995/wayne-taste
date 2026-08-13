# Design-conformance review protocol

Use this protocol for the independent design review after drafting. The
[source-fidelity protocol](source-fidelity-review.md) owns whether every upstream
obligation survived; the [execution-readiness protocol](execution-readiness-review.md)
owns whether a fresh agent could execute the plan. This review asks one question only:
**is the plan building THIS design?**

A plan can satisfy every requirement and every decision and still build a different
system — state under a different owner, a seam in a different place, a flow that skips
a component the spec's diagram routes through. The obligations survive; the
architecture does not. That drift is invisible to the other two voices by construction:
one checks clauses, the other judges the plan as written.

Read the living spec, the decision log, and the plan. The spec's diagrams, interface
blocks, ownership statements, and technology constraints are the design; the plan is a
claim about how it will be built. Compare them.

## Component and ownership

- Every unit names the spec component, interface, or ownership surface it realizes, or
  says it is cleanup with none. A unit naming a surface the spec does not have is
  unapproved design.
- State the spec assigns to one owner is written by that owner in the plan. A second
  writer, a cache the plan invents, or a value resolved from somewhere else is the SSoT
  drift class and is a BLOCKER.
- A component the spec names and no unit realizes is unbuilt design. A component the
  plan introduces and the spec does not name is unapproved design. Both are findings,
  and the second is worse because it looks like progress.

## Interfaces and flow

- Signatures, parameters, return shapes, and errors match the spec's interface blocks.
  A widened, narrowed, renamed, or re-owned surface is a finding even when every
  requirement still passes through it.
- Trace each spec `sequenceDiagram` through the plan's units. Name any step the plan
  drops, reorders, or routes through a different component.
- The `## Technology and frameworks` constraints — version floors, platform limits,
  licences, costs — are carried, not re-decided. A plan choosing a different library has
  made a product decision it does not own.

## Declared deviation

A plan may deviate where it declares the deviation and its reason against the named
spec surface. Judge the declaration:

- a HOW-level reason — a repository constraint the design did not know about — is
  acceptable; report it as informational so the user still sees it;
- a WHAT-level reason is an unapproved design change: it needs a decision, not a
  sentence in a plan;
- an undeclared deviation is a BLOCKER whatever its merit.

## When the sources disagree

The spec's `## Decisions` and its architecture surfaces are in force together. Where
they contradict each other, that is a finding against the upstream sources and not
licence for the plan to pick a side. Report it and name both.

Do not judge whether the design is good — that was settled upstream, and re-opening it
here is the failure the product voice already owns at design time. A conviction that the
design itself is wrong is a challenge to a decision: report it as exactly that and let
adjudication route it to the user.

## Non-oracles

Matching vocabulary, a unit named after a component, and a plan that reads plausibly are
not conformance. Two different designs describe the same feature with the same nouns.
Compare what owns what and what calls what.

## Reporting

Every finding cites the spec surface and the plan surface it compares and quotes both.
An ownership violation, an undeclared deviation, or an unrealized component is a
BLOCKER; a declared HOW-level deviation is informational. Return the harness-provided
JSON object; add no prose wrapper and no compliments.
