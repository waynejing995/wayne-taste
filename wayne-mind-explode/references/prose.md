# Spec prose

How the narrative sections are written. Structured lines in `## Requirements`, `## Verification`, and `## Decisions` — `**Target** — …`, `**Governs** — …` — are data, not prose, and are exempt. Everything a person reads as sentences is covered here.

## The standard

Write the way an engineer explains a system to the colleague who will maintain it. Name the component, say what it owns, say what happens when it fails. Every sentence should be something a reader can act on or check.

A specification is impersonal and precise. No first person, no humour, no admitted ambivalence, no deliberate looseness.

## What this does not touch

Rules written for essays damage a specification. These are correct here and are never findings:

- **A system component as the subject.** `The dispatcher verifies the token` is the right sentence. Do not rewrite operational sentences to put a person in front.
- **Passive voice with a known actor.** `The event is stored by the server` is fine. Passive is only a problem when it hides _who_, which is a separate check below.
- **Technical adverbs.** `idempotently`, `asynchronously`, `atomically`, `monotonically` carry meaning. An adverb ban would delete the specification.
- **Repeated phrasing across requirements.** Identical wording for identical obligations is a feature. Variation is the defect — see synonym cycling.
- **MUST / MUST NOT / SHALL** in normative text.

Personal wording preference, sentence length, and uneven detail between sections are also not findings.

One more caution: stacking restrictions produces stiff, generic prose that reads more artificial than the habits it removed. Fix what obscures the design and stop.

## Habits observed in this pipeline's output

Each of these was measured in a real generated spec. Fix them before review.

### Compressed antithesis

The most common one. Not every contrast is a defect — the distinction is whether both sides were earned.

_Earned_ — both halves are supported by what precedes them, and the contrast names a real alternative that was on the table. Keep it.

_Compressed_ — one side is a leap the reader has no basis for, and the cadence implies the contrast before any evidence arrives. `X, not Y` and `X and never Y` compress a design statement into a slogan, and the half that got dropped is usually the half the reader needed. Expand it by naming the unsupported side.

| Written | Rewrite |
| --- | --- |
| `D86 — Completion is declared, not evidenced` | `D86 — A unit is complete when the engineer declares it. TRACE does not inspect the work.` |
| `D35 — Identity, not authentication` | `D35 — The hook sends a user id. The server records it and does not verify it.` |
| `D60 — Nothing computes whether a run is stuck` | `D60 — No component infers that a run has stalled. The overview shows the last report time and the reader judges.` |
| `a managed, uniform process, not ticket-to-PR without a person` | `a managed, uniform process. A person still opens every pull request.` |

The test: does the sentence state what the system does, or only what it is not? A reader cannot implement a negation.

### Argument-shaped headings

A human section heading is a label. A generated one compresses the section's argument into a miniature summary. `Alternatives considered` and `Failure and concurrency` are labels. `Why the hook is the right enforcement point` is an argument, and it presents a conclusion where the reader expected a location.

Decision headings are the exception that proves it: `### D<n> — <the decision>` is a plain statement of what was decided, not a case for it. If the heading would fit on a slide, it has dropped a detail the reader needs.

| Written | Rewrite |
| --- | --- |
| `D16 — The hook is not a permission system` | `D16 — The hook refuses one action, code pull request creation, and permits everything else.` |

### Rule of three

`same skills, same rules, same phase order` reads as completeness and is rarely true. Name what is actually in the set. Two is fine. Four is fine.

### Filler transitions

`Two consequences show up immediately.` announces content instead of delivering it. Delete the sentence and state the consequence. Same for `It is worth noting that`, `Importantly`, and `There is also a gap …`.

### Abstract nouns standing in for components

`surface`, `carrier`, `voice`, `shape`, `edge`, and `flow` each name something concrete in this system. Use the concrete name: `review page`, `outbox`, `reviewer`, `topology`, `boundary`, `sequence`. If an abstract term is load bearing, define it once and then use it unchanged.

### Synonym cycling

The worst one in a specification, because it looks like good writing. Calling one thing `the recipe`, `the devcontainer.json`, `the environment definition`, and `the pinned config` across four paragraphs forces the reader to work out whether those are four things. One term per concept, repeated. Repetition is correct here.

### Trailing `-ing` clauses

`… storing the event, ensuring nothing is lost` adds a claim without a mechanism. Make it a sentence with a subject: `The server stores the event. A retry carrying the same id is ignored.`

### Em dashes used for rhythm

A weak signal, and getting weaker: several vendors now suppress em dashes, and by 2026 only some models used them more than professional writers do. Do not treat a count as evidence of anything on its own.

It still fires here. One 605-line spec from this pipeline carried 125 em dashes in its 418 narrative lines, one every 3.3 lines, which is punctuation doing the work of sentence structure. Keep the dash for a genuine parenthetical and use a comma or a full stop elsewhere. Splitting a long sentence in two is usually the fix.

## Checks that fire on content, not voice

These catch a draft that reads clean and specifies nothing. Run them per section.

**Load-bearing specifics.** Count the names, numbers, dates, paths, error codes, and service names in each section. Zero means the section is untreated generated text. This is the most reliable signal in the list, and it is the one worth running first.

`significantly improves latency` is untreated. `p99 falls from 840ms to 190ms` is not.

**Falsifiable rejection reasons.** Every entry in `## Alternatives considered` and every `## Non-goals` line states why, in terms that could be checked. `rejected for operational complexity` is not a reason. `rejected: needs a second Zookeeper ensemble, and we are capped at one` is.

**Risks that belong to this design.** A generated `## Failure and concurrency` lists universal risks — latency, cost, complexity. A real one lists the modes this architecture makes possible, with the observable behavior for each.

**Vague attribution.** `benchmarks show`, `the industry standard is`, `it is widely accepted that`, with no benchmark, link, or incident named. Cite the source or drop the claim.

**Claims a reader would act on.** Endpoints, flags, config keys, version floors, and command names are the categories generated text fabricates most confidently. Verify each against the codebase before review.

## Reported elsewhere, not yet seen here

High-signal tells in design documents generally. They have not appeared in this pipeline's output, so they are listed for recognition rather than as a checklist. If one starts firing, move it up.

- **Process narration** — describing the work that produced the text instead of its findings: `After evaluating the available options, we determined that…` rather than `We chose Postgres because…`. Reported as the strongest single tell in design docs.
- **Missing actors** — an operational sentence with no doer: `the data is backfilled` hides which team runs it and when. Restore the actor in anything operational: who runs it, who is paged, who approves the rollback.
- **Compulsive summaries** — a recap under every heading in a document too short to need one.
- **False ranges** — `handles everything from single-tenant deployments to global multi-region fleets`, which implies a spectrum and skips the scaling analysis.

## Two passes that catch most of it

1. Read the narrative aloud. Anywhere you would not say it to a colleague at a whiteboard, rewrite it.
2. Read only the decision headings, in order. They should read as a list of engineering statements. If they read as aphorisms, rewrite them before review.
