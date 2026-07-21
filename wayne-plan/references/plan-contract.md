# Wayne plan contract

This file owns the semantic information a plan must carry into `wayne-work`.
`_shared/pipeline-id-contract.md` solely owns cross-stage identifier namespaces.
The template is a starting layout, not a Markdown grammar.

## Contents

1. Inputs and temporary evidence
2. Plan identity and lifecycle
3. Required plan information
4. Requirement and unit relationships
5. Test Matrix ownership
6. Content constraints
7. Blocking artifact
8. Review and scope proof

## 1. Inputs and temporary evidence

Read the complete approved decision log, spec, test matrix, relevant code and tests,
active plans, and applicable lessons. When planning from a direct request, preserve
the user's request in the working context rather than converting it into a synthetic
schema.

Record the starting Git commit and status. Build any temporary coverage map in the
form most useful to the agent. It should connect source obligations and decisions to
plan units, account for U seeds, identify the E owner, and preserve any genuinely
normative literal or forbidden alternative. It is working evidence, not a shipped
artifact or parser input.

Contextual reading decides which clauses are requirements, decisions, findings,
rationale, or examples. Headings, IDs, table shape, keywords, regex, and substring
search may help navigation but cannot prove semantic classification or completeness.
Both independent reviews reverse-audit source → working map → plan. Preserve source
artifacts unchanged; canonical aliases in working notes never authorize rewriting
their source rows.

## 2. Plan identity and lifecycle

Write English Markdown to:

```text
docs/plans/YYYY-MM-DD-NNN-<feat|fix|refactor>-<3-5-word-name>-plan.md
```

Use a clear date, sequence, change type, and short lowercase name. Keep lightweight
metadata so downstream agents can identify the plan and lifecycle, for example:

```yaml
title: <non-empty title>
type: <feat|fix|refactor>
status: active
date: YYYY-MM-DD
origin: <repo-relative source path or none — converged direct request>
decisions: <repo-relative decision-log path or none — no decision log exists>
```

The filename and metadata must agree in meaning. Source paths are repository-relative
and name the actual inputs. Status remains `active` while drafting; only both
independent review passes authorize `approved`. `wayne-work` accepts only an approved
plan. Metadata order and YAML surface style are not correctness requirements.

## 3. Required plan information

Organize the plan for a fresh executor. The template's headings are recommended
because they make review easier, but agents may combine, rename, or reorder sections
when the same information remains clear and traceable.

The plan must communicate:

- the problem, approved requirements, scope boundaries, decisions, and rationale;
- repository context, active-plan constraints, applicable lessons, and open questions;
- dependency-ordered implementation units, affected files/symbols, cleanup, and
  system-wide impact;
- each unit's goal, requirements, dependencies, consumed and produced interfaces,
  concrete approach, patterns, test scenarios, E contribution, verification, and
  decision trace where applicable;
- risks, dependencies, and links to every authoritative source.

Use stable unit and requirement IDs when they help cross-reference the plan. A
legitimate absence must include a reason; no exact sentinel wording or heading order
is required. The independent reviewers judge whether information is missing,
ambiguous, duplicated, or disconnected.

## 4. Requirement and unit relationships

- Every source requirement maps to at least one unit, and each feature unit states
  the requirements it advances. Pure cleanup explains why it has no source requirement.
- Dependencies point only to earlier units and explain why. Independent units say so.
- Consumed and produced interfaces identify repository-relative files and the most
  specific useful symbol, owner, input/output shape, and role. A consumer from an
  earlier unit must agree semantically with what that unit produces.
- File entries say create, modify, or delete and describe the concrete work. Existing
  paths and symbols are verified through repository reading; future symbols are
  clearly identified as outputs rather than pretended to exist already.
- Use the most specific semantic surface consistently. A new field or method is
  `Type.member` in both `Produces` and `Files`, even though that member does not
  exist yet; `Modify` requires the path, not the future symbol, to preexist. Never
  widen `Type.member` to `Type` or strip its owner merely to satisfy equality.
- Patterns name existing repository surfaces to follow when relevant.
- Decision traces carry every WHAT-level decision into the units it governs. HOW-only
  detail does not need a fabricated decision, but its ownership and rationale stay clear.

Paths remain repository-relative. Review meaning and repository evidence rather than
backticks, punctuation, arrow count, or one fixed `path::symbol` sentence grammar.

## 5. Test Matrix ownership

The authoritative E contract remains in the linked test-matrix artifact. Carry its
complete rows, meaning, IDs, columns, order, wording, and `⬜` status into the plan
without authoring, dropping, normalizing, or advancing them. If the upstream owner
explicitly decided that no E contract applies, preserve that decision and reason.
The copy in the plan is a read-only execution aid, not a second status owner.

Author the U layer against real implementation units. A Markdown table is the
recommended compact view:

```markdown
| ID | Owner | Seed | Surface | Scenario | Status |
|---|---|---|---|---|---|
```

Each U scenario must:

- have a stable ID and exactly one existing owning unit;
- identify whether it re-authors a source seed or adds coverage found during planning;
- name the real repository-relative unit surface it exercises;
- communicate concrete preconditions or inputs, action, branches where relevant,
  and observable outcome in natural prose; and
- start at `☐`, which only `wayne-work` may advance.

Re-authoring may change the unit surface and wording, but it must preserve the source seed’s accepted and rejected behavior sets, boundary classes, ordering, state timing, quantities, modality, negation, and every other qualifier. Do not narrow, widen, normalize, or omit those obligations. A drop reason must show from approved sources and repository evidence why no U scenario is warranted without discarding or weakening the seed’s behavior. Source-fidelity review compares each original seed in context with its mapped U scenario or drop reason; any changed obligation fails the review and returns the plan to revision.

Account for every source seed once: map it to a U scenario or record an explicit,
evidence-backed drop reason, never both. A small table is recommended:

```markdown
### Dropped Seeds

| Seed | Reason |
|---|---|
```

Every feature-bearing unit owns useful U coverage; non-feature units explain why no
U scenario applies. Every E row is advanced by at least one unit, unless the source
explicitly owns an E-none decision. `wayne-work` alone changes U status; `wayne-verify`
alone changes E status. Independent AI review checks all ownership and seed coverage
in both directions; table shape, sentence form, and arrow count are not correctness
oracles.

## 6. Content constraints

Name actual branches, failures, inputs, actions, and expected results. Contextual
execution-readiness review decides whether wording is specific enough; no phrase
list, substring, or regex can prove that prose is a placeholder. Pseudocode and
diagrams are directional guidance, not pre-written implementation.

Keep paths repository-relative. Do not put implementation commands, commit recipes,
or unrelated changes into the plan. Do not claim an execution-time unknown is
resolved; defer it with a reason only when it cannot change approved WHAT-level
behavior. If implementation requires a behavior, compatibility, migration,
ownership, failure, or public-interface choice not covered by the source or plan,
the plan is incomplete and must return to the user.

## 7. Blocking artifact

On an active conflict or absent owned E contract, do not create a plan. Return a
compact blocker containing these facts:

```text
STATUS: BLOCKED
REASON: PLAN_CONFLICT or MISSING_E2E
ARTIFACTS: <semicolon-separated repo-relative paths>
OWNER: product-design or test-design
<one concise Chinese explanation>
```

Choose the applicable reason and owner: `PLAN_CONFLICT` belongs to product design;
`MISSING_E2E` belongs to test design. Name the real source artifacts and explain the
blocking gap in concise Chinese. The example is a shared communication convention,
not a line-count or regex grammar; semantic completeness is what matters.

## 8. Review and scope proof

Two independent AI reviews own acceptance:

- source-fidelity reads every upstream artifact and the repository evidence, then
  checks requirements, decisions, scope, rationale, E ownership, seed disposition,
  and semantic equivalence in both directions;
- execution-readiness checks unit closure, dependencies, interfaces, real files and
  symbols, cleanup, U ownership, E advancement, risks, and whether a fresh executor
  can work without inventing a decision.

Both reviews compare the recorded starting commit/status, agent write history, and
final Git diff before checkpoint handoff. Only the new plan may change during plan
authoring; `wayne-checkpoint` later owns its own artifacts. A required change to a
source artifact or unrelated file means the plan input or scope is incomplete: stop and ask the user.
Do not recursively scan repository contents, open unrelated files, or require
permission repair to prove scope.

Templates, Markdown shape, hash ledgers, section counts, and scripts do not prove
plan correctness. If future tooling introduces a real non-AI plan consumer, add
mechanical validation only for that consumer's published interface.
