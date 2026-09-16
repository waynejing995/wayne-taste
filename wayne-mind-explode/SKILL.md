---
name: wayne-mind-explode
description: Converges a feature, system, or architecture idea through repository-grounded questioning into an approved decision log, test matrix, and design spec, then runs three independent design reviews and hands off to wayne-plan. Use for “brainstorm”, “mind explode”, “let's design”, “grill me”, or equivalent Chinese design requests; never use it to implement or write the implementation plan.
---

# Wayne Mind Explode

Turn an unresolved idea into approved design inputs for `wayne-plan`.

## Boundary

Own discovery, decision convergence, design approval, test-design delegation, conflict resolution, spec writing, independent design review, and handoff. Never implement code or write an implementation plan. Do not commit, branch, push, or publish unless separately requested.

`decision locked`, `design approved`, or an equivalent milestone freezes design state; it never authorizes execution. Continue only this Flow, hand off to `wayne-plan`, and stop. Never execute the plan or invoke `wayne-work`.

Create only design artifacts, and only two kinds.

**Run-scoped, in `.wayne/runs/<topic>/`** — working state, gitignored, absorbed or promoted before handoff:

- `decision-log.jsonl`
- `test-matrix.md` through `wayne-test-design`
- `review-{product|engineering}.md` — each voice's latest report; the log carries the rounds
- `spec.md` — the candidate, until the user approves its exact bytes
- the handoff packet owned by `wayne-checkpoint`

**Durable, in `docs/`** — one living page per topic, the sole artifact that outlives the run:

- `docs/specs/<topic>.md` — replaced in place from an approved candidate, never re-dated

`docs/specs/` holds only bytes the user has approved. Each revision enters it by being moved there at node V and leaves only by becoming `deprecated`. Until then the candidate lives in the run directory, which is why an abandoned run leaves nothing behind and why the living page never shows unapproved design.

Nothing else goes in `docs/`. A run abandoned mid-design is the normal case, not the exception, and anything it left in `docs/` would sit there forever looking exactly like a shipped design. Keeping the whole working set outside the tracked tree removes that failure instead of scheduling a cleanup for it.

## Flow

```mermaid
flowchart TB
    A["Open decision log"]
    B["Research one fact or branch"]
    P["Persist one discovered decision"]
    C{"Next DAG node?"}
    D["Ask one recommended question"]
    Q["Persist one user decision"]
    E["Converge and approve design"]
    F["Create test matrix"]
    G["Conflict and legacy review"]
    H{"Conflict remains?"}
    I["Write spec"]
    M["Run the mechanical checks"]
    V{"Written spec approved?"}
    J["Run three independent reviews"]
    K{"All three valid on the final revision, zero findings?"}
    ADJ["Adjudicate findings"]
    R["Revise from findings"]
    U{"Review mechanism available?"}
    X(["Stop: review unavailable"])
    L(["Handoff to wayne-plan"])

    A --> B
    B --> P
    P --> C
    C -->|"fact"| B
    C -->|"choice"| D
    D --> Q
    Q --> C
    Q -->|"challenge rejected"| ADJ
    C -->|"empty"| E
    E --> F
    F --> G
    G --> H
    H -->|"yes"| D
    H -->|"no"| I
    I --> U
    U -->|"yes"| M
    M --> V
    U -->|"no"| X
    V -->|"no: revise"| I
    V -->|"yes"| J
    J --> K
    K -->|"yes"| L
    K -->|"no"| ADJ
    ADJ -->|"carrier loss / real defect"| R
    ADJ -->|"challenges a decision / upstream gap"| D
    ADJ -->|"all remaining non-blocking"| L
    R --> M
```

## Process

### A. Open or resume the decision log

Read `../_shared/pipeline-id-contract.md` completely. Before anything else, resolve whether this topic already has a living spec at `docs/specs/<topic>.md`.

- **No spec.** New topic. Create the log with `meta.status` `in-progress` and start decision IDs at `D1`.
- **Spec exists.** This run amends that spec; it never opens a second one. Read the whole file — every entry of its `## Decisions` section, and every spec named in a `Depends on` line. Create the log with `meta.status` `in-progress`, and **continue that spec's decision numbering**. Restarting at `D1` puts two `D1`s in one spec and destroys the uniqueness its namespaced IDs depend on. An already-recorded decision is reversed only by a new record naming it in `supersedes`; never edit or delete the existing entry, and never silently re-decide it because it was absent from this run's context.

Seed the run-scoped log from [the template](templates/decision-log.jsonl) — one `meta` line, replacing `topic-slug` with this run's topic; leaving the placeholder makes `meta.topic` disagree with the run directory, which fails loud rather than quietly mislabelling the log. The record schema, the field semantics, and the append-versus-rewrite rule are all in the pipeline contract you just read; they are not restated here and cannot live inside a JSONL file. That log is working state: it dies once section I absorbs its content into the living spec, so nothing durable may exist only there.

### B. Research project and lessons

**Initial survey.** Start with the topic's living spec and every spec named by its `Depends on` edges; these are the current design, not background reading. Use parallel subagents to research all relevant directions and seed known root and dependent nodes.

**Check spec freshness before seeding.** A spec is current only if its metadata supports that claim and no evidence contradicts it. Check these dates first:

- `today >= stale_after`: the spec has reached its re-reconciliation date.
- It has `verified` entries, but the latest predates `generated.at`: the content changed after its last runtime confirmation.

No `verified` entry means design-approved but never run, not stale; only `wayne-verify` writes runtime confirmations. A trusted spec seeds the nodes it answers as `resolved`, with `resolved_by` pointing to its `<slug>:D<number>`. A spec failing either check cannot seed resolved nodes: treat its claims as unverified and use G's three-way triage against the code. Existence alone never establishes trust.

**Research one fact.** Select the next reachable open `fact` and process at most one before P:

- **Repository:** read instructions, relevant code, docs, architecture, active plans, other specs, and recent history.
- **KB:** find semantically matching lessons, prior decisions, research, how-tos, and project notes. Surface matches and log whether the user applies or skips them.
- **Web:** research similar implementations and reusable solutions for software-stack selection. Otherwise, search only when current external facts could change a design choice. Store source URLs in the decision's `reference`; a source that cannot be reopened is not evidence.

**Classify the result.** Evidence-backed facts resolve without user confirmation, but P must persist their numbered evidence before they become resolved. Only trusted spec references may seed resolved nodes directly. Every design-relevant source fact belongs in both a `decision` record and the DAG, never only in prose notes. Intent, priority, risk, scope, and trade-offs are user-owned `choice` nodes. Ambiguous or conflicting evidence also stays open as a choice.

**Expand consequences.** After every resolved node, identify new purpose/scope, ownership, interface, data/control flow, failure/concurrency, compatibility, operations, verification, or rollback decisions. Persist every real child before selecting the next node; a broad parent answer does not resolve its consequences.

### P. Persist one discovered decision

Append the single discovered fact or constraint as one new `decision` record. In that same write, rewrite its node's line to `resolved` with `resolved_by` set, and append every child it opened as `open` or `blocked`; verify both the record and the frontier before selecting another node. Do not carry an unlogged fact or unpersisted child into the next branch.

### D. Ask one recommended question

Select the next reachable open `choice` from the durable DAG. Before asking, have subagents verify that B's research has not missed any code, documentation, or facts relevant to this choice. Never infer precedence between conflicting inputs.

For that decision:

1. **Explain.** Use plain, explanatory text without assuming topic-specific background. Add Mermaid diagrams for relevant structure or data flow, including changes introduced by the options.
2. **Compare.** Present two or three options grounded in current evidence and decisions. Explain how each works and its impact. Recommend one with reasons, its key assumption, and its reversal condition; give each alternative's distinct advantage or trade-off.
3. **Ask.** Use the question tool to request the user's choice neutrally, then wait. Ask about exactly one decision node, regardless of sentence count or punctuation; do not repeat the question in a heading or closing.

The recommendation is advice, not a default or a disguised approval request. Silence, agreement with the framing, or acceptance of a parent node does not approve this node or its children. Treat `whatever`, `I don't care`, and other non-decisions as unresolved: explain the consequence, restate one recommendation, and wait. Route the answer immediately to Q before moving on.

Include software-stack selection as a required choice, using B's research to identify reusable solutions rather than reinventing them. Route UI design choices through `wayne-frontend-design` when the global Frontend rule applies.

### Q. Persist one user decision

Append only the answered decision as one new `decision` record and verify it is durable before researching or asking the next branch. In the same write, rewrite that node's line to `resolved` with `resolved_by` set, and append all children opened by the answer. If the answer did not resolve the choice, leave the node `open` and return to D without writing a decision record.

### E. Converge and approve design

**Convergence gate.** Every DAG node must be `resolved` or `not-applicable`, and a coverage audit must find no missing branch across purpose, scope, ownership, interfaces, data/control flow, failure/concurrency, observability, verification, rollback, and legacy impact. There is no question cap: decision count, turn count, context length, or a complete-looking summary never substitutes for an empty frontier; 40+ resolved decisions with one open node must continue. Only the user may explicitly stop or request a partial wrap-up.

**Compare approaches.** After the user confirms shared understanding, compare three genuinely distinct viable approaches against the decision log, lead with a recommendation, and record the choice. If approved constraints leave only two viable approaches, name the eliminated third direction and explain why it is not viable; do not pad the comparison.

**Approve the design.** Present architecture, components, state/data ownership, flows, failure behavior, boundaries, and verification in reviewable sections. Wait for explicit approval of each material section and log every revision. Keep units single-purpose with explicit interfaces and dependencies, follow existing patterns, and exclude unrelated refactors.

**Record the frontier lock.** Only when the user freezes the frontier, set `frontier_locked` to `true` in the log's `meta` line. Convergence alone does not lock it; resumed runs use this flag to distinguish the two states.

**Apply the cybernetics lens when relevant.**

- **Triggers:** state/lifecycle, a control plane, multiple readers or writers, streaming, observability, source-of-truth drift, feedback/retry, workflow orchestration, or a gate, validator, or classifier judging another component's output. Skip a small single-file pure-logic change with no persistent state or integration.
- **Analysis:** name Plant, Controller, Setpoint, Disturbance, and Feedback. Record only relevant observability, controllability, ownership, stability, and minimum-control-effort findings.
- **User decisions:** give each finding a severity and proposed intervention, then present them one at a time. The user chooses which interventions apply; log every acceptance or rejection before test-matrix or spec work.

### F. Create test matrix

After design approval, invoke `wayne-test-design` with the decision log and settled design. It solely owns the unit/integration matrix and E2E Verification Contract. All design-stage E statuses remain `⬜`. Record the returned matrix path.

### G. Conflict and legacy review

Re-read all existing plans, specs, architecture, and repository instructions against the settled design. Route any contradiction to D and repeat this review.

When the contradiction is between a living spec and the code, the spec is not presumed stale. Classify it and route accordingly:

| Finding | Meaning | Action |
| --- | --- | --- |
| Spec is right, code diverged | An unapproved implementation drift | Do not touch the spec; report it as a defect |
| Spec is stale, code is right | The design moved and was never written back | Update the spec in place, appending one decision entry that records why it moved |
| The new design overrides the spec | A real design change | Obtain a user decision, then update the spec in place |

Only the user chooses between these. Defaulting to "the spec is stale" launders an unapproved deviation into approved design, which is the one failure of this mechanism that causes real damage. A spec updated here has its `generated.at` advanced, which invalidates every earlier `verified` entry and re-arms the review gate. Trace replaced functionality and classify it `Dead`, `Legacy`, or `Shared`; obtain its direct callers and indirect consumers such as jobs, scripts, APIs, and external repositories. Obtain and log a user decision for every deletion, deprecation, or migration. Proceed only with zero unresolved conflicts.

### I. Write spec

Read [the spec contract](references/spec-contract.md) in full before drafting; it owns frontmatter, section contents, architecture and diagrams, requirement/decision traceability, and writing rules. Use [the spec skeleton](templates/spec.md) for a new topic; for an amendment, start from the current living page under the contract's `## Candidate versus in force` rules.

Write only the candidate at `.wayne/runs/<topic>/spec.md`, never the living page at this node. Set `generated` to this run's actor and time.

1. **Write the narrative first, then derive the appendix.** Integrate load-bearing decisions into the architecture or alternatives they shaped; do not build an R/D catalog and add explanatory prose afterwards.
2. **Absorb the matrix's E2E layer into `## Verification`.** Carry the existing contract forward rather than authoring a second one; follow the spec contract's verification-state ownership rules.
3. **Revise and check.** Apply the contract's `## Prose` guidance, then execute its complete `## Before review` checklist.

### M. Run the mechanical checks

Every path that reaches V has just rewritten the candidate's bytes, so I and R both land here. Run both checkers against `.wayne/runs/<topic>/spec.md`, fix what they report in the candidate, and re-run until both are clean.

- [the format checker](scripts/check_spec_format.py) — `uv run <path> <candidate>` — the bounded sections downstream stages parse, the `R`/`D` contracts, the narrative/appendix divider, layering with prose per level, and the two prose habits with a signature. On an amendment add `--compare docs/specs/<topic>.md`, which proves the rewrite dropped no `R<n>` or `D<n>`.
- [the mermaid checker](scripts/check_mermaid.mjs) — `node <path> <candidate>` — parses every `mermaid` block with mermaid's own grammar and rejects a renderer config or a diagram type outside the portable profile. It installs its pinned parser once under `~/.cache/`; the spec bytes never leave the machine. This gate exists because every reader of the spec downstream — the three voices at J included — reads the source rather than the rendering, so a diagram that renders as an error box in the user's editor is caught by nobody else.

A checker that cannot run is a hard stop: report the missing capability rather than continuing without it, because a skipped check is indistinguishable from a passed one in everything written afterwards. Neither checker judges design. A clean run means the file is well formed, never that it is right, and it replaces neither the contract's fresh-eyes reading nor the three voices.

### U. Require an independent-review mechanism

Establish that the mechanism exists before a page goes in force; this node discovers capability and does not review anything. Find how the current agent launches isolated read-only subagents, and record what it is. The review criteria are provider-neutral and live in the three templates below; only the dispatch mechanism is host-specific. J launches one subagent per voice, in parallel, each carrying exactly one protocol path — `references/product-review.md`, `references/engineering-review.md`, and `references/decision-carriage.md` — over the same artifact set: the approved spec revision, the decision log, and the test matrix. No voice edits anything, and the gate is computed only after all three return. Product and engineering must land on different model families — they argue about the same bytes, so one family collapses them into one opinion. Carriage compares two artifacts against each other rather than arguing, so its independence comes from a fresh isolated context; it may share a family. If the isolated executions cannot be started, if any voice fails or returns nothing, or if product and engineering collapse onto one model family, return `REVIEW_UNAVAILABLE` with the missing capability and stop, before anything is promoted. If the failure only surfaces when J actually runs, move the page back to `.wayne/runs/<topic>/spec.md`, clear `written_spec_approved` and `approved_spec_sha256`, and return `REVIEW_UNAVAILABLE` from there: an in-force page no voice could read is worse than no page. Never simulate a voice in one local analysis or silently downgrade to fewer reviews. A requested model is not a routed model: after J runs, read each reviewer execution's actual model from the host's run metadata, and void the run the same way if any voice fell back to the session default or product and engineering resolved to one family.

### V. Approve the written spec

The review mechanism is already known by this point; a page must not go in force before it is certain that anyone can review it. Show the candidate at `.wayne/runs/<topic>/spec.md` and ask the user to approve that exact written revision. A prior section-by-section approval is not approval of the file bytes. On rejection, log one decision, revise the candidate, and ask again. Start no reviewer until the written revision is explicitly approved.

On approval, set `written_spec_approved` to `true` and `approved_spec_sha256` to the digest of the approved bytes in the log's `meta` line, then **move** the candidate onto `docs/specs/<topic>.md` byte for byte — replacing the previous revision on an amendment, creating the page on a new topic. Move, never copy: two copies would immediately begin to disagree. Never edit during or after the move; the bytes the reviewers in J read are the bytes the user approved, and changing so much as the status line would make that untrue.

### J. Run three independent reviews

**Dispatch.** Use the mechanism established in U to send the same approved spec revision to three separate reviewer executions. Each must read and follow its assigned protocol:

| Voice | Remit | Protocol |
| --- | --- | --- |
| Product | Problem, necessity, and user value | [Product review](references/product-review.md) |
| Engineering | Buildability, performance/capacity, and operations | [Engineering review](references/engineering-review.md) |
| Carriage | Obligation-preserving transcription from decision log to spec | [Decision carriage](references/decision-carriage.md) |

The protocols own the detailed review criteria. Carriage is an independent audit of I's transcription, not an author self-check; the other two voices treat the log as context, not as the artifact being transcribed.

**Record evidence.** Keep each voice's latest report at `.wayne/runs/<topic>/review-{product|engineering|carriage}.md`, with its role, verdict, and the digest of the bytes it read. Preserve history in the decision log: append one `decision` record per round with `"source":"review"` and the report path in `reference`. Never rewrite an earlier round's record.

**Count valid rounds.** Three valid rounds is the cap. One round dispatches all three voices against one promoted page; it counts only when every voice actually executes on its own routed model and returns a report naming the digest it read. A failed execution, termination before its report, empty result, or collapse onto another voice's model family produces no judgment: rerun it and count nothing. **Three voices in one round are not three rounds.**

**Handle outcomes through the existing Flow.**

- **Before the cap:** all three voices must pass. Route `REVISE` through adjudication; when a revision is required, move `docs/specs/<topic>.md` back to `.wayne/runs/<topic>/spec.md`, clear `written_spec_approved` and `approved_spec_sha256`, and revise the candidate. Obtain V's approval of the revised bytes before promotion, then rerun every voice against the promoted page. Never leave an unapproved or half-revised page in `docs/specs/`.
- **On the third valid round:** take findings through ADJ as usual, then proceed. Append anything still open to the decision log as non-blocking, naming the round cap as the reason. Do not send the page back for a fourth revision/review cycle.

**Protect approved bytes.** The cap relaxes only the verdict gate. All three voices must still have executed against the same final bytes, whose digest is `approved_spec_sha256`; a voice that never ran cannot satisfy the cap. Any later design-content edit makes those passes stale. The sole exception is `wayne-verify` appending a runtime `verified` entry after ship: it confirms the same design without re-arming the gate. Never add review notes to the spec after the passes, or let a reviewer write its own pass into the bytes it reviewed.

### ADJ. Adjudicate findings against the decision log

Read [the adjudication contract](../_shared/finding-adjudication.md) completely; it owns the dispositions, the challenge route, and the gate. A reviewer judges the spec's bytes and has no standing over the decisions behind them, so this node is the only place a locked decision is defended. Classify every finding here before any candidate byte changes. Any non-empty findings set arrives here whatever verdict the voices returned. Skip this node only when all three valid executions report zero findings.

Number the round's findings `F<number>` and append one `decision` record with `"source":"review"` whose `decision` field carries each finding's disposition and the `D<number>` it rests on, and whose `reference` is the report path.

A `CHALLENGES_DECISION` needs a durable node before it can be asked: append one `open` `choice` node naming the challenged `D<number>`, then route to D, which selects it like any other. The question carries that `D<number>`, the finding, and the evidence the reviewer has that was not on the table when the decision was made. Q resolves that node either way:

- **Stands.** One `user` decision recording the rejection, `supersedes` empty — a defended decision is not reversed by defending it. Return here with that finding permanently non-blocking.
- **Reopened.** One record naming the original in `supersedes`; its descendants are re-audited and the design re-enters the frontier at C.

Promotion proceeds once every finding is either resolved by a revision or non-blocking. A finding the user already rejected never re-blocks, however many rounds raise it again.

### L. Handoff to wayne-plan

Rewrite the log's `meta` line: `status` to `design-approved`, `spec` and `test_matrix` to their paths. `design-approved` requires `frontier_locked` and `written_spec_approved` to already be `true`; it records that both gates were passed, and never stands in for either. Tell the user their paths and that `wayne-plan` is the next agent. Invoke `wayne-checkpoint` in handoff mode with those artifacts and `next agent: wayne-plan`; return the packet without auto-advancing. End here.

## Red lines

- No code, scaffolding, implementation plan, or unrequested commit.
- No question whose answer exists in the repository or approved sources.
- No spec before all required decisions and conflicts are resolved.
- No duplicated E2E contract or second test-matrix owner.
- No claimed review round without three real executions on the final revision.
- No self-check substitutes for the carriage voice: the author of a transcription cannot audit it.
- No reviewer finding may reverse a decision; only a new record naming it in `supersedes` does, and only the user asks for one.
