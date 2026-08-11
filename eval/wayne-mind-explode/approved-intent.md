# Approved intent: Wayne Mind Explode

The skill turns an unresolved idea into durable, user-approved design inputs for
`wayne-plan`. It owns convergence and review, never implementation or planning.

## Intent coverage matrix

| ID | Recovered behavior | Source | Oracle |
|---|---|---|---|
| I01 | Create one `in-progress` decision log before research or the first question. | pre-slim Skill, Phase 1 | final artifact + first write event |
| I02 | Discover one repository/KB/web fact or obtain one user decision, append exactly one `decision` record durably, then advance to the next branch. One write event may also rewrite `meta` and node lines, but never makes a second decision durable, and the log is never reconstructed later. | pre-slim Flow `Log decision`; user correction; current trace | native write events plus blind decision-boundary review |
| I03 | The decision log is JSONL: one compact JSON object per line, one line per entity, exactly one first-line `meta`, consecutive canonical `D<number>` ids, `N<number>` nodes, and source values `user`, `codebase`, `web`, `constraint`, `default`, or `review`. Every decision carries a `reference` locating its answer, a `web` decision carries its URL, and a node the living spec already answered is resolved by an external `<slug>:D<number>`. Legacy markdown decision tables stay readable without rewrite. | `_shared/pipeline-id-contract.md` | schema validator plus blind log review |
| I04 | Read repository instructions, code, docs, history, active plans/specs, prior decisions, relevant KB lessons/research/how-tos/project notes, and decision-changing current web facts before asking discoverable questions. | pre-slim Phases 2.1–2.3 | research/no-handwave held-out |
| I05 | Walk the dependency-ordered decision tree; ask one recommended question and wait. Reject `whatever`/`I don't care` as unresolved instead of inventing a default. | pre-slim Phase 3; grilling commit `170ad4865582` | one-question and vague-answer case |
| I06 | At convergence, compare three genuinely distinct viable approaches, record the choice, and obtain approval for every material design section. Use two only when approved constraints leave exactly two viable directions, and explain why the third direction is not viable. | pre-slim Phases 4–5; current Skill E; user correction 2026-07-20 | complete design case plus blind source-fidelity review |
| I07 | For triggered state/control designs, record Plant, Controller, Setpoint, Disturbance, Feedback, severity, and proposed interventions; the user selects interventions before matrix/spec work. | pre-slim cybernetics contract | cybernetics-choice held-out |
| I08 | Delegate the test matrix exactly once to `wayne-test-design`; it alone writes the matrix and E2E contract. Mind Explode only links it. | commit `636c81e`; pre-slim Phase 5 | native invocation/artifact evidence plus blind ownership review |
| I09 | Recheck plans/specs/architecture, trace direct callers and indirect consumers of replaced functionality, classify Dead/Legacy/Shared, and obtain migration/deletion decisions. | pre-slim Phase 6 | conflict and legacy held-out |
| I10 | Write the canonical spec only after design convergence, then obtain explicit user approval of the written spec bytes before launching reviews. | pre-slim Phase 7 | written-spec approval gate |
| I11 | Product review challenges premise, necessity, whether this is the right problem, the 10-star alternative, user value, assumptions, scope, and non-goals. | pre-slim CEO/founder review contract | product playbook case |
| I12 | Engineering review challenges architecture, ownership, interfaces, data/control flow, failures, edge/concurrency paths, tests, performance/capacity, observability, rollback, and execution readiness. | pre-slim engineering review contract | engineering playbook case |
| I13 | Run two genuinely independent heterogeneous reviewer executions on identical spec bytes. Missing either voice fails loud; no same-context simulation or single-review fallback. | pre-slim dual review intent; repository policy | review events + unavailable case |
| I14 | A `REVISE` updates the spec and decision log, invalidates both stale reviews, and reruns both. Both must pass the exact final bytes. | pre-slim Phase 8 | review hash/event oracle |
| I15 | Each voice's latest report lives at `.wayne/runs/<topic>/review-{product\|engineering}.md`, naming its role, verdict and reviewed digest; the decision log carries every round as an append-only `decision` record whose `source` is `review` and whose `reference` is that report. A `REVISE` returns the page to the run directory before it is edited. | current harness + state-owner rule; follow-up review 2026-07-21 | artifact, outcome and digest checker |
| I16 | Mark `design-approved`, return a checkpoint handoff to real `wayne-plan`, and never invoke or auto-advance planning. | pre-slim Phase 9 + checkpoint contract | handoff + planner trap |
| I17 | Keep units/interfaces bounded, follow existing patterns, and avoid unrelated refactors in the design. | pre-slim Design for Isolation | spec boundary held-out |
| I18 | The decision log durably owns a dependency-ordered DAG frontier with stable nodes and `fact` versus `choice` kind. Resolving a node persists newly opened children before selecting the next node. | `708779e:wayne-mind-explode/SKILL.md` Phase 3 rules 3-7; `failure-evidence-dag.md` | three-turn snapshots/write order plus blind DAG-semantic review |
| I19 | Convergence depends only on an empty DAG frontier, never turn count, decision count, summary length, or apparent design sufficiency. A 40+ decision log with an open node must continue. | `failure-evidence-dag.md` user correction | 42-node late-frontier Claude/Codex case |
| I20 | Evidence-backed `fact` nodes auto-resolve and are logged without user confirmation. `choice` nodes involving intent, priority, risk, scope, or trade-offs require one recommended question; ambiguous/conflicting facts remain unresolved. | current Skill B/D boundary; `failure-evidence-dag.md` | auto-resolved ownership fact + kind/evidence mutations |
| I21 | A locked decision frontier freezes design input but never authorizes implementation, plan execution, or `wayne-work`; continue only the remaining design approvals and end at the `wayne-plan` handoff. | user correction in `failure-evidence-decision-lock.md`; pre-slim boundary and Phase 9 | decision-locked no-execution case |
| I22 | Grilling expands the causal consequences of every resolved node and has no model-imposed question cap; unresolved downstream ownership, failure, compatibility, operations, verification, and rollback branches stay open. | pre-slim Phase 3 rules and grill menu; Matt Pocock `grilling`; `failure-evidence-depth.md` | deep branch-expansion case |
| I23 | A recommendation is evidence-grounded and revisable advice, not a default decision: expose its key assumption, strongest alternative, and reversal condition, then ask the user's choice neutrally. | user correction in `failure-evidence-depth.md`; Matt Pocock `grilling` decision ownership | non-leading recommendation case |
| I24 | For each open user-owned choice, offer three concrete, genuinely distinct options by default and recommend one. Offer two only for a genuinely binary decision, state why no third distinct option exists, and never pad with a fake variant. | `wayne-mind-explode/SKILL.md@e54ee99`, D; user correction 2026-07-20 | `three-options` case; blind AI judge reads the complete case and response |
| I25 | The living spec is the human-readable durable artifact. It is named after its topic — never dated, never `-design` — numbers approved behavior as `R<number>` with Current/Target/Acceptance, maps every requirement to a proof in `## Verification`, and shows shape as mermaid diagrams plus signature-level interface sketches. | `wayne-mind-explode/references/spec-contract.md`; user correction 2026-07-21 | complete-case spec observations |
| I26 | A frozen frontier, an approved written spec, and `design-approved` are three separate user acts carried explicitly in `meta`; none is inferred from an empty DAG. The living page is replaced byte for byte from an approved candidate, so `docs/specs/` never holds a byte the user did not approve and reviewers read exactly those bytes. | user correction 2026-07-21 via follow-up review | lock, copy-vs-move and digest lanes |

Every intended clause maps to executable evidence or blind review. A candidate
cannot be accepted while any row is `UNVERIFIED`.

## Exact reproduced failure

The accepted slim version still says “append immediately”, but its Flow removed
the `Log decision` transition. In the preserved Codex complete-case trace, one
write created decisions 1–10, the next added 11–19, then later writes added 20–23
and 24–25. The final file passed the old checker, proving final-state equality is
not timing evidence.

The frozen trace checker rejects any write event that makes more than one new
decision durable. A positive trace has:

```text
decision 1 ready → append record D1 → verify durable → next branch
decision 2 ready → append record D2 → verify durable → next branch
```

## Hard boundaries

- No implementation code, implementation plan, unrequested commit, branch, push,
  publish, or automatic next-stage execution.
- Do not read, load, invoke, or restore gstack or its legacy review names. Replace
  the two review capabilities with self-contained playbooks and real reviewers.
- `wayne-test-design` remains the only matrix/E2E author.
- Runtime paths and review dispatch stay provider-neutral across Claude and Codex.
- User-facing language remains owned by repository instructions, not duplicated in
  this Skill.
- A long decision history never relaxes the unresolved-frontier or one-question gate.

## Optimization classification

Restore behavioral state transitions and dense playbook intent, not the old 513-line
checklist, provider-specific tools, unconditional web search, automatic commit, or
duplicated matrix authoring. The target is a bounded procedure revision, not a
revert.
