---
type: Design Spec
title: <Declarative outcome — the end state, not a task name>
description: <one line — what this component is and what it guarantees>
tags: [<component>, <area>]
status: draft
generated: { by: <actor>, at: <ISO 8601 — last meaningful change> }

# Add only when warranted — an absent key carries meaning, an empty one does not:
#   verified: [{ by: ..., at: ... }]
#   stale_after: <YYYY-MM-DD>
#   sources: [{ id: ..., resource: ..., title: ... }]
#   related: [./<slug>.md]
---

<!--
LIVING PAGE. This file always describes the CURRENT design of its topic, not a
snapshot of one design run. Name it after the topic — `authentication.md`, not
`2026-05-01-auth-design.md`. A later run that changes this design edits this
file in place and appends to `## Decisions`; it does not create a second file.

This is the only durable artifact of a design run. The DAG, research trail,
test-matrix draft, and review reports are run-scoped and die at ship. What must
outlive them is absorbed here.

OKF v0.2. `type` is the only required field; everything else is optional and
its absence carries meaning. Change history is git — no changelog section.

status       draft | stable | deprecated  — these three values only.
             draft   = not yet approved.
             stable  = approved and in force (absent `status` means this).
             deprecated = the topic is gone, split, or merged; point `related`
             at the successors. Superseding a decision is a table row, not a
             new file, and never `deprecated`.

generated    { by, at }. `by` uses the actor convention: `<producer>/<version>`
             for agents, `human:<id>` for people, `process:<id>` for automated
             processes. `at` marks the last meaningful content change.

verified     One entry per confirmation event, each { by, at }. This is where
             the review gate lands as data instead of prose: each independent
             reviewer voice appends one entry, and the user's explicit approval
             appends `human:<id>`. Consumers derive the trust tier — no entries
             = unverified, non-human only = machine-confirmed, any `human:` =
             human-reviewed. Content can change without re-confirmation, so a
             `generated.at` later than every `verified.at` means this spec is
             approved-then-edited and the gate must run again.

stale_after  Optional absolute date. Stale when `today >= stale_after`. It is the
             only mechanical defence against drift available here: it makes
             "this needs re-checking against the code" a date comparison rather
             than something a human has to remember. Set it when the area moves
             fast enough that silent staleness would mislead; omit it when the
             design is genuinely settled.

sources      Provenance, replacing the v0.1 `# Citations` body list. Each entry
             needs `resource`; give it an `id` when the body cites it, then
             attribute the individual claim with a markdown footnote keyed to
             that id — `[^adr-tls]` — never a positional index.

Delete every section that does not apply. An empty heading is worse than none.
-->

# <Title>

## TL;DR

<2-4 sentences. A reader decides in 15 seconds whether this concerns them.>

## Problem

<What breaks without this, from the user's or operator's perspective. No
solution language here.>

## Solution

<The end state from the user's perspective. Still no mechanism.>

## Non-goals

<Explicitly out of scope. The no-s are as load-bearing as the yes-s: they are
what a future reader checks before "improving" something that was deliberate.>

## Behavior

<The observable contract, as scenarios. This is what `## Verification` proves
and what a reviewer argues with. Externally observable only — no internals.>

### <Scenario name as a capability>

- **Given** <starting state>
- **When** <the trigger>
- **Then** <the observable outcome>

## Design

### Architecture and ownership

<Components, and which one owns each piece of state. Name where every piece of
state lives; if two answers exist, the design is not finished.>

### Interfaces

<Public boundaries and their contracts. Name modules and interfaces, not file
paths — interfaces survive refactors.>

### Data and control flow

<How a request or event moves through the components. Who writes, who reads.>

### Failure and concurrency

<Behavior on each failure mode; retry, idempotency, ordering, concurrent
access. Silent degradation is a defect, not a fallback.>

### Observability

<What is logged, at what level, and what a reader can conclude from it.>

### Rollback

<How this is undone if it goes wrong, and what becomes unrecoverable.>

## Legacy

<What this replaces. Every deletion, deprecation, or migration needs a user
decision before approval. Drop this section once the migration has landed.>

| Item | Class | Consumers | Decision |
|---|---|---|---|
| <path or component> | Dead \| Legacy \| Shared | <direct callers + jobs, scripts, APIs, other repos> | <delete \| deprecate \| migrate \| keep> |

## Verification

<How this is proven to work in the real process on the real path. Link the actual
tests with relative links. This is the durable E2E contract once the run-scoped
test matrix is gone.

No status column. Whether a run passed is run-scoped state and belongs to the
matrix; that this spec has been verified is durable and belongs to the `verified`
frontmatter entry, which also carries who confirmed it and when.>

| Scenario | Proof |
|---|---|
| <from `## Behavior`> | [<test>](../../tests/e2e/<file>) |

## Decisions

<The decisions that JUSTIFY this design — not the research trail. A fact resolved
by reading the codebase dies with the run; a choice, and a constraint that
eliminated an option, belongs here.

One section per decision, titled with the decision itself, so that reading only
the headings gives the whole decision set. This is the read-optimized form of the
run-scoped decision log's table: that file is written one row per turn by an agent
and then deleted, this one is read by a human months later.

Append-only across runs. Reversing an earlier decision adds a new section naming it
in `Supersedes`; never edit or delete the superseded section. IDs are namespaced by
this file's slug — `authentication:D7` — so they stay unique when a script derives a
repo-wide decision graph; within this file, bare `D7` is fine.

Omit any line that does not apply. Only the title and the rationale paragraph are
always present.>

### D<n> — <the decision itself, as a declarative statement>

<Why. One short paragraph: the force that made this the answer, and the
alternative it beat. A decision resting on an external fact cites it with a
footnote keyed to a `sources` entry.[^<source-id>]>

- **Consequences** — <the cost this accepts: what it makes harder, slower, or
  irreversible. Never a restatement of the rationale. Omit only when the decision
  accepts no cost, which is rare.>
- **Depends on** — <a decision in another spec that constrained this one, cited as
  [`<slug>:D<n>`](./<slug>.md). Only edges that genuinely exist. Never copy a
  decision into a second spec: the spec owning the state or interface owns the
  decision, everyone else references it.>
- **Supersedes** — <`D<n>`, or `<slug>:D<n>`, comma-separated.>
- **Decided** — <YYYY-MM-DD, by user | codebase | web | constraint | default | review>
