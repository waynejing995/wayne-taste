# Decision Log — <topic>

Status: in-progress

<!--
RUN-SCOPED WORKING FILE. It holds the frontier while the run is live and dies
once its content is absorbed into the living spec at `docs/specs/<topic>.md`.
Nothing durable may exist only here.

Tables are the right shape for this file and the wrong shape for the spec. Here
the reader is an agent appending one row per turn and scanning statuses; there
the reader is a human months later, so the spec carries the same decisions as
scannable sections instead. The reformat is safe because this file is deleted,
not kept alongside it.
-->

| ID | Question | Decision | Rationale | Consequences | Supersedes | Source |
|---|---|---|---|---|---|---|
| D1 | ... | ... | ... | ... | — | user |

## Decision DAG

| Node | Parent | Kind | Decision | Status | Opens when |
|---|---|---|---|---|---|

## Rules

**IDs.** Assign the next `D<number>` without leading zeroes. Review reports use
`F<number>`; never reuse `R<number>`, which is reserved for requirements. When
this run amends an existing spec, continue that spec's numbering instead of
restarting at `D1`.

**One row per write.** One file-write event appends exactly one new numbered
row. Verify it is durable before researching, asking, approving, or handing off;
never batch rows or reconstruct the log later.

**Source** is one of `user`, `codebase`, `web`, `constraint`, `default`,
`review`.

**DAG nodes.** Use stable dependency-ordered node IDs. `Kind` is `fact` or
`choice`. `Status` is `blocked`, `open`, `resolved`, or `not-applicable`, and
the cell holds that literal and nothing else. `Decision` names the unresolved
fact or choice and is never blank or `—`. `Opens when` holds only the activation
predicate. Preserve supplied node boundaries and dependencies: one turn
processes one node, and one answer never batch-resolves split nodes. Seed known
roots and dependents as `open` or `blocked`, then add children as their parent
resolves.

**Consequences** records the cost this decision accepts — what it makes harder,
slower, or irreversible. It is the field a later reader uses to judge whether
the trade-off still holds. It never restates `Rationale`, and it never lists the
follow-up choices the decision opened: those are DAG children, and duplicating
them here creates two encodings of one frontier. Write `—` only when the
decision accepts no cost, and expect that to be rare.

**Supersedes** is `—`, or one or more earlier decision references: a same-table
`D<number>`, or a decision carried by another living spec, cited as
`<slug>:D<number>`, comma-separated. Never edit or delete a superseded row. The
reversal is stored once, on the superseding row, and supersession is derived by
reading forward; marking both ends would store one edge twice. A superseding
row's `Rationale` states why the earlier decision was reversed, and its own
`Consequences` covers the cost of reversing. Re-audit every descendant the
superseded decision opened and append a new row for each one that changes;
supersession never cascades automatically, and a resolved DAG node is never
silently reopened.
