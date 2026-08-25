# Design spec contract

Rules for writing `docs/specs/<topic>.md`. The skeleton is [the spec template](../templates/spec.md); this file says what makes a filled-in one correct.

## What this file is

**A living page, and the only durable artifact of a design run.** It always describes the CURRENT design of its topic, never a snapshot of one run. Name it after the topic — `authentication.md`, not `2026-05-01-auth-design.md`. A later run that changes this design edits this file in place and appends to `## Decisions`; it never creates a second file. The DAG, research trail, test-matrix draft, and review reports are run-scoped and die at ship.

**Its readers are the engineer who will implement it and the agent working alongside them.** Both need to know what to build and what it must satisfy. Neither needs to be taught the domain: this is not a guide, a tutorial, or a wiki page, and it never explains a concept the implementer already has. Prose is here because a boundary, a trade-off, and a failure behavior do not survive being written as fields — not because the document is meant to read easily.

**One spec covers one feature, and covers it completely.** Everything an implementer needs is in this file. A second document is opened only when the feature is genuinely too large for one, and a feature of ordinary size never needs one — describe it clearly here instead of deferring to a document that does not exist yet.

The run-scoped `decision-log.jsonl` is the machine-oriented form written one record per turn; this file is the durable form of the same decisions.

Change history is git. There is no changelog section.

## Frontmatter

OKF v0.2. `type` is the only required field; every other key is optional and its absence carries meaning, so add a key only when warranted — an absent key means something, an empty one does not.

| Key | Rule |
| --- | --- |
| `status` | `stable` \| `deprecated`, always written. `stable` = in force, and the candidate carries it too because promotion must not change a byte. `deprecated` = the topic is gone, split, or merged — point `related` at the successors. Superseding a decision is a new `## Decisions` entry, never `deprecated`. |
| `generated` | `{ by, at }`. `by` uses the actor convention: `<producer>/<version>` for agents, `human:<id>` for people, `process:<id>` for automated processes. `at` marks the last meaningful content change. |
| `verified` | One entry per **runtime** confirmation event, each `{ by, at }`, appended by `wayne-verify` after it exercises the real path. Design reviewers never write here: a voice that attested inside the bytes it reviewed would invalidate its own pass. Their passes live in the immutable review reports and the decision log, keyed by the digest they read. |
| `stale_after` | Optional absolute date. Stale when `today >= stale_after`. Set it when the area moves fast enough that silent staleness would mislead; omit it when the design is genuinely settled. |
| `sources` | Provenance. Each entry needs `resource`; give it an `id` when the body cites it, then attribute the individual claim with a markdown footnote keyed to that id — `[^adr-tls]` — never a positional index. |
| `related` | Sibling or successor specs, as relative paths. |

Consumers derive the trust tier from `verified`: no entries = design-approved but never run, any entry = confirmed against the running system, and a `human:` entry = a person watched it. Content can change without re-confirmation, so a `generated.at` later than every `verified.at` means this spec was edited after it was last proven and the gate must run again.

## Candidate versus in force

A run never edits `docs/specs/<topic>.md` directly. It stages its candidate at `.wayne/runs/<topic>/spec.md`, already carrying the `status: stable` it will hold in force, and the living page is replaced with those exact bytes only once the user has approved them. An amendment works the same way: it starts from the current in-force bytes, revises the candidate, and promotes.

The point is that `docs/specs/` never holds a byte the user did not approve, and the bytes the independent reviewers read are the bytes that were approved. A workflow that promotes first and adjusts afterwards — even only the status line — has already broken that, because the approval no longer names what is in force.

## Sections

Delete every section that does not apply. An empty heading is worse than none.

**The narrative is self-contained; the appendix is its source.** Everything above the `# Appendices` divider is prose a person reads start to finish — `## Abstract`, `## Background`, `## Problem statement`, `## Goals`, `## Non-goals`, `## Architecture`, `## Alternatives considered`, `## Interfaces`, `## Flows`, `## Failure and concurrency`, `## Observability`, `## Rollback`. Everything below it is the numbered source that prose cites: `## Requirements`, `## Verification`, `## Decisions`, `## Technology and frameworks`, `## Legacy`. A reader who stops at the divider must already understand the design; the appendix is where they go to check a citation, never to discover what was specified.

**`## Background` carries the current state this design changes, once, as continuous prose.** What exists now in the code and how it behaves, plus any constraint already binding on the answer. It is bounded by what an implementer needs in order to judge the design that follows: name the modules, the current behavior, and the earlier decision that is in the way. It is not a history of the system, not an introduction to the domain, and not a summary of the product. If a paragraph does not change how the reader evaluates a later section, cut it.

A current-state account split across twenty per-requirement `Current` fields is not a background; it is a table the reader has to transpose in their head. State it here once, and let each `R<n>` name only the single fact it changes.

**`## Requirements` is the sole definer of `R<number>`.** Nowhere else in the pipeline mints one. Each requirement is falsifiable: a verifier can write a check that resolves to pass or fail. `Current` / `Target` / `Acceptance` are all three required — a requirement without `Current` cannot be shown to have changed anything, and one without `Acceptance` cannot be verified. `Current` names the single fact this requirement changes; the continuous account stays in `## Background`. "Improve performance" is not a requirement; "p99 falls from 800ms to under 200ms, proven by <check>" is.

**The narrative carries the design in full; `R<number>` carries its checkable form.** A threshold, cap, ordering, or output contract belongs in the prose that explains the component, stated concretely, numbers included — a reader who has to open the appendix to learn what a component does is reading a table of contents. The owning `R<number>` states the same obligation as a pass/fail check that a verifier can run, and downstream stages read it there. The two are one rule in two forms, and they must agree exactly; where they disagree, the R is the one a downstream stage will act on, so fix whichever is wrong rather than deleting one.

**`## Verification` maps every `R<number>` to a proof.** An unmapped requirement is a gap, not an omission. Carry no pass/fail status: whether a run passed is run-scoped state owned by the test matrix, and the durable fact that this spec was verified is a `verified` frontmatter entry.

**`## Decisions` carries every decision the specified behavior depends on**, not the research trail. A choice, a constraint that eliminated an option, and a codebase fact the design leans on all belong here; only a fact the specified behavior does not depend on dies with the run. Independent review judges these bytes, so a load-bearing decision left in the run-scoped log reaches the reviewer as an unanswered question. One entry per decision, titled with the decision itself, so reading only the headings gives the whole decision set.

An entry is a **provenance index, not a second statement of the rule**. Where the decision constrains specific requirements, the entry is the decision, its rationale, and an exact `Governs R5, R7` line naming them — the rule itself stays on those Rs. A framing decision that governs no requirement (a technology pick, a boundary, an eliminated option) carries its own text and no link, because it has no other home.

That split is what keeps a decision from being weakened in transcription: a rule written out twice drifts, and a spec with two versions of it has no statement of which one is in force. An entry that would write the rule out again cites it instead.

Each entry carries its `Consequences`, and a `Depends on` line whenever a decision in another spec constrained this one, cited as [`<slug>:D<n>`](./<slug>.md). Only edges that genuinely exist; never copy a decision into a second spec, because the spec that owns the state or interface owns the decision and everyone else references it.

It is append-only across runs. Reversing an earlier decision adds a new entry naming it in `Supersedes`; never edit or delete the superseded entry. IDs are namespaced by this file's slug — `authentication:D7` — so they stay unique when a script derives a repo-wide decision graph; within this file, bare `D7` is fine.

## Diagrams and code

A design that can only be read as prose is not readable. Show the shape.

**Diagrams are mermaid**, fenced as ` ```mermaid `, because they render in GitHub, Obsidian, and most editors without a build step. Use `flowchart` for structure and ownership, `sequenceDiagram` for a flow across components. A diagram that merely restates the prose beside it earns nothing — delete one of the two.

**`## Architecture` is layered, and every layer this feature reaches is in this file.** A real system has levels, and a single diagram holding all of them is not a summary of the design — it is the design with its levels erased, leaving the reader to recover them by counting nodes. Open at the outermost level: this system, the actors and systems it exchanges with, and what crosses each boundary. Then descend one level at a time, each its own `###` with its own prose. A level gets a diagram when it has structure a diagram can carry — parts, direction, or ordering the sentences would have to enumerate. A leaf that is one boundary and one pin does not, and adding a diagram there to look consistent produces exactly the diagram this contract elsewhere says earns nothing. Prose is what every level owes; a diagram is what some levels need.

These are progressive views of one architecture, each showing the same system at a finer grain. They are not audience tiers: there is no version for a newcomer and a second version for an implementer, because the only reader is the implementer.

**What is in scope for descent.** A part this feature introduces, changes, or depends on through a mechanism that is not obvious from its interface. That last case is the one worth naming: a dependency whose contract is `store(id, payload)` needs no level, while one whose ordering, idempotency, or failure behavior the design leans on does.

**Where descent stops.** At a stable inherited or external interface — describe what crosses the boundary and what is relied on, not what is inside someone else's system. And at the point where the remaining detail is the order in which to build things rather than how the thing is built, which is the implementation plan's.

Within that scope, descending is neither optional nor deferrable. A level this feature introduces or changes and does not describe has been hidden rather than summarised, and "a later document will decompose this" is not available: one spec covers one feature and carries that feature's levels. File length is not a reason to stop; leaving the feature's own surface is.

A part earns its own level when any of these holds, and the check is mechanical:

- it owns a row in the state-ownership table;
- it has a failure mode of its own in `## Failure and concurrency`;
- it could be replaced without changing the level above it;
- the prose says "internally it …" and no diagram shows that inside.

A diagram that already groups its nodes into subgraphs is usually drawing two levels at once, and those subgraph boundaries are where it splits. Prose at every level answers what its diagram cannot: why these boundaries, and what each part is answerable for. A level with a diagram and no prose has shown the structure without explaining the design.

**`## Technology and frameworks` names every technology a reader needs in order to understand this design**, with the role it plays, what it beat, and the constraint it imposes — version floor, platform limit, licence, or cost. Mark each `new` or `inherited`: a reader who cannot tell which choices this run made cannot tell which ones are open to challenge. Downstream stages copy those constraints verbatim, so a constraint that lives only in someone's head is a constraint the plan will break. Omit only infrastructure the design does not touch.

**Interfaces show the boundary, then one illustrative call.** The signature block carries types, names, parameters, return shapes, and errors. The usage block carries a call site, request/response, or event payload with fake values and the real shape — a reviewer catches an awkward boundary from how it is called far faster than from its declaration. Neither block carries bodies, algorithms, or error-handling detail: that is the implementation plan's job, and putting it here creates a second source of truth that drifts the day someone writes real code.

Name modules and interfaces, not file paths. Interfaces survive refactors; paths do not.

## Prose

Write the narrative the way an engineer explains a system to a colleague who has to maintain it. State what a component does, what it owns, and what happens when it fails. A reader should be able to act on every sentence. A specification is impersonal and precise.

A generated draft carries LLM writing habits. They are not a style preference: each one replaces information with emphasis, and a reviewer then argues with the emphasis instead of the design. [The prose reference](prose.md) lists the habits measured in this pipeline's output, the content checks that catch a draft which reads clean and specifies nothing, and — equally important — the essay-writing rules that must not be applied to a spec, because a component subject, a technical adverb, and identical phrasing across requirements are all correct here.

## Before review

Approved specs contain no assumptions, open questions, TBDs, or TODOs. Unresolved material stays in the run-scoped log. Read the written file once with fresh eyes and fix inline:

1. **Placeholders** — any `TBD`, `TODO`, unfilled `<...>`, or vague requirement.
2. **Contradictions** — does the architecture match the requirements, and do the diagrams match the prose?
3. **Ambiguity** — could any requirement be read two ways? Pick one and say it.
4. **Scope** — is this focused enough to become one implementation plan?
5. **Carrier leak** — walk the run-scoped decision log record by record. Each one either has a home in these bytes, or an explicit reason the specified behavior does not depend on it. This is a presence sweep and nothing more: whether each home carries the same obligation is judged by the carriage voice at J, because an author reads their own sentence as obviously meaning what they meant.
6. **Narrative and appendix disagree** — take each threshold, cap, ordering, and output contract in the prose and read the `R<number>` that owns it. Do they state the same obligation? A number that drifted, a condition the R dropped, or a case the prose added is the finding. Do not resolve it by deleting the prose: the narrative is meant to carry the design, and a downstream stage will act on the R, so both have to be right.
7. **Narrative self-sufficiency** — read only from the title down to `# Appendices`. Is the design understandable there, without reading further? A sentence whose content is a pointer — "the gate behaves as R7 defines", "see D33" — fails this, and so does an `## Architecture` that is a diagram and a table with no prose between them.
8. **Flattened architecture** — does any part meeting a level test in `## Diagrams and code` lack its own level? Does any diagram carry subgraphs that were never described one at a time? Both mean levels were erased rather than explained.
9. **AI writing habits** — walk the table in `## Prose` against the narrative and the decision headings. Slogan headings, antithesis, em dashes used for rhythm, rule-of-three lists, filler transitions, and vague abstractions are all rewritten here, not waved through.

Personal wording preference and uneven detail are not findings. The habits listed in `## Prose` are: they cost the reader information, which is why they are a checklist item rather than taste.
