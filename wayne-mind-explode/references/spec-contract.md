# Design spec contract

Rules for writing `docs/specs/<topic>.md`. The skeleton is
[the spec template](../templates/spec.md); this file says what makes a filled-in
one correct.

## What this file is

**A living page, and the only durable artifact of a design run.** It always
describes the CURRENT design of its topic, never a snapshot of one run. Name it
after the topic — `authentication.md`, not `2026-05-01-auth-design.md`. A later
run that changes this design edits this file in place and appends to
`## Decisions`; it never creates a second file. The DAG, research trail,
test-matrix draft, and review reports are run-scoped and die at ship.

**Its reader is a human, months later.** The run-scoped
`decision-log.jsonl` is the machine-oriented form written one record per turn;
this is the read-optimized form of the same decisions. That is why this file uses
prose, diagrams, and signatures where the log uses fields.

Change history is git. There is no changelog section.

## Frontmatter

OKF v0.2. `type` is the only required field; every other key is optional and its
absence carries meaning, so add a key only when warranted — an absent key means
something, an empty one does not.

| Key | Rule |
|---|---|
| `status` | `draft` \| `stable` \| `deprecated`, these three values only, always written. `draft` = not yet approved and still in the run directory. `stable` = approved and in force. `deprecated` = the topic is gone, split, or merged — point `related` at the successors. Superseding a decision is a new `## Decisions` entry, never `deprecated`. |
| `generated` | `{ by, at }`. `by` uses the actor convention: `<producer>/<version>` for agents, `human:<id>` for people, `process:<id>` for automated processes. `at` marks the last meaningful content change. |
| `verified` | One entry per confirmation event, each `{ by, at }`. This is where the review gate lands as data instead of prose: each independent reviewer voice appends one entry, and the user's explicit approval appends `human:<id>`. |
| `stale_after` | Optional absolute date. Stale when `today >= stale_after`. Set it when the area moves fast enough that silent staleness would mislead; omit it when the design is genuinely settled. |
| `sources` | Provenance. Each entry needs `resource`; give it an `id` when the body cites it, then attribute the individual claim with a markdown footnote keyed to that id — `[^adr-tls]` — never a positional index. |
| `related` | Sibling or successor specs, as relative paths. |

Consumers derive the trust tier from `verified`: no entries = unverified,
non-human only = machine-confirmed, any `human:` = human-reviewed. Content can
change without re-confirmation, so a `generated.at` later than every
`verified.at` means this spec is approved-then-edited and the gate must run
again.

## Sections

Delete every section that does not apply. An empty heading is worse than none.

**`## Requirements` is the sole definer of `R<number>`.** Nowhere else in the
pipeline mints one. Each requirement is falsifiable: a verifier can write a check
that resolves to pass or fail. `Current` / `Target` / `Acceptance` are all three
required — a requirement without `Current` cannot be shown to have changed
anything, and one without `Acceptance` cannot be verified. "Improve performance"
is not a requirement; "p99 falls from 800ms to under 200ms, proven by <check>" is.

**`## Verification` maps every `R<number>` to a proof.** An unmapped requirement
is a gap, not an omission. Carry no pass/fail status: whether a run passed is
run-scoped state owned by the test matrix, and the durable fact that this spec
was verified is a `verified` frontmatter entry.

**`## Decisions` carries the decisions that JUSTIFY this design**, not the
research trail. A fact resolved by reading the codebase dies with the run; a
choice, and a constraint that eliminated an option, belongs here. One entry per
decision, titled with the decision itself, so reading only the headings gives the
whole decision set.

Each entry carries its `Consequences`, and a `Depends on` line whenever a decision
in another spec constrained this one, cited as [`<slug>:D<n>`](./<slug>.md). Only
edges that genuinely exist; never copy a decision into a second spec, because the
spec that owns the state or interface owns the decision and everyone else
references it.

It is append-only across runs. Reversing an earlier decision adds a new entry
naming it in `Supersedes`; never edit or delete the superseded entry. IDs are
namespaced by this file's slug — `authentication:D7` — so they stay unique when a
script derives a repo-wide decision graph; within this file, bare `D7` is fine.

## Diagrams and code

A design that can only be read as prose is not readable. Show the shape.

**Diagrams are mermaid**, fenced as ```` ```mermaid ````, because they render in
GitHub, Obsidian, and most editors without a build step. Use `flowchart` for
component and ownership structure and `sequenceDiagram` for a flow across
components. One diagram that carries the whole architecture beats five that each
carry a corner of it. A diagram that merely restates the prose next to it earns
nothing — delete one of the two.

**`## Technology and frameworks` names every technology a reader needs in order to
understand this design**, with the role it plays, what it beat, and the constraint
it imposes — version floor, platform limit, licence, or cost. Mark each `new` or
`inherited`: a reader who cannot tell which choices this run made cannot tell which
ones are open to challenge. Downstream stages copy those constraints verbatim, so a
constraint that lives only in someone's head is a constraint the plan will break.
Omit only infrastructure the design does not touch.

**Interfaces show the boundary, then one illustrative call.** The signature block
carries types, names, parameters, return shapes, and errors. The usage block
carries a call site, request/response, or event payload with fake values and the
real shape — a reviewer catches an awkward boundary from how it is called far
faster than from its declaration. Neither block carries bodies, algorithms, or
error-handling detail: that is the implementation plan's job, and putting it here
creates a second source of truth that drifts the day someone writes real code.

Name modules and interfaces, not file paths. Interfaces survive refactors; paths
do not.

## Before review

Approved specs contain no assumptions, open questions, TBDs, or TODOs.
Unresolved material stays in the run-scoped log. Read the written file once with
fresh eyes and fix inline:

1. **Placeholders** — any `TBD`, `TODO`, unfilled `<...>`, or vague requirement.
2. **Contradictions** — does the architecture match the requirements, and do the
   diagrams match the prose?
3. **Ambiguity** — could any requirement be read two ways? Pick one and say it.
4. **Scope** — is this focused enough to become one implementation plan?

Minor wording, stylistic preference, and uneven detail are not findings.
