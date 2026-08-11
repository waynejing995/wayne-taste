# Wayne pipeline identifier contract

This file is the single owner of identifiers exchanged between Wayne stages.
Producer and consumer skills link here; they do not redefine or infer namespaces.

## Canonical namespaces

| ID | Owner | Meaning |
|---|---|---|
| `N<number>` | `wayne-mind-explode` | decision-DAG node |
| `D<number>` | `wayne-mind-explode` | durable decision-log row |
| `F<number>` | design/code review owner | review finding; never a requirement |
| `R<number>` | approved spec/test design | product requirement |
| `S<number>` | `wayne-test-design` | provisional U-SEED row |
| `I<number>` | `wayne-plan` | implementation unit |
| `U<number>` | `wayne-plan` | unit/integration test row |
| `E<number>` | `wayne-test-design` | E2E contract row |

Canonical numbers are positive decimal integers without leading zeroes. IDs are
recognized only in their defining bounded table or section; a matching token in
prose, another table, a review report, or a filename has no cross-stage meaning.
Never inventory IDs by scanning a whole file for `R\d+`, `D\d+`, or similar tokens.

## Defining structures

The decision log is `.wayne/runs/<topic>/decision-log.jsonl`: one compact JSON
object per physical line, one line per entity, no comments and no trailing commas.
Three record types, discriminated by `type`.

```jsonl
{"type":"meta","topic":"delivery-retry","status":"in-progress","spec":null,"test_matrix":null,"frontier_locked":false,"written_spec_approved":false,"approved_spec_sha256":null}
{"type":"node","id":"N1","parent":null,"kind":"choice","decision":"How the retry budget is bounded","status":"resolved","opens_when":null,"resolved_by":"D1"}
{"type":"decision","id":"D1","question":"...","decision":"...","rationale":"...","consequences":"...","supersedes":[],"source":"user","reference":null}
```

It is machine-oriented run state — one entity per line, one resolved decision per
write event — and it is deleted at ship. The human-readable form of the same
decisions is the living spec's `## Decisions` section, which outlives the run.

**Write discipline.** `decision` records are append-only. `meta` and `node`
records are rewritten in place. Resolving a node is one write event that appends
exactly one `decision` line, rewrites that node's line, and appends one line per
child the answer opened. Never batch two decisions into one write, and never
reconstruct the file from memory.

A `resolved` node is never silently reopened. Reversing what it settled is a new
`decision` record naming the old one in `supersedes`, after which every descendant
it opened is re-audited.

**Validity.** A newly produced log has exactly one `meta` record, on the first
line. Every line is a complete compact JSON object. Every `D<number>` and every
`N<number>` appears at most once, and decision numbers run consecutively — from
`D1` on a new topic, or from the next free number when this run amends an existing
spec. A record carries every key its type defines and no others — an unrecognized
key is a producer bug, not an extension point.

**Absent versus `null`.** `null` means explicitly no value or not yet set — no
parent, no cost accepted, not yet resolved. An absent key means **unknown**; a
consumer never invents a value for one and never rewrites the log to supply it.
Only a legacy source produces absent keys.

| Record | Key | Type | Rule |
|---|---|---|---|
| `meta` | `type` | `"meta"` | exactly one record, first line |
| `meta` | `topic` | string | the run's topic slug; also names the run directory |
| `meta` | `status` | string | `in-progress` or `design-approved` |
| `meta` | `spec` | string \| null | `docs/specs/<topic>.md`, `null` until the spec is in force |
| `meta` | `test_matrix` | string \| null | `.wayne/runs/<topic>/test-matrix.md`, `null` until it exists |
| `meta` | `frontier_locked` | boolean | the user froze the decision frontier |
| `meta` | `written_spec_approved` | boolean | the user approved the exact written spec bytes |
| `meta` | `approved_spec_sha256` | string \| null | the digest of the bytes the user approved; `null` until then |
| `decision` | `type` | `"decision"` | append-only |
| `decision` | `id` | string | `D<number>`, unique |
| `decision` | `question` | string | what was being decided |
| `decision` | `decision` | string | the answer |
| `decision` | `rationale` | string | why this answer beat the alternative |
| `decision` | `consequences` | string \| null | see below |
| `decision` | `supersedes` | string[] | see below; `[]` when nothing is reversed |
| `decision` | `source` | string | `user`, `codebase`, `web`, `constraint`, `default`, or `review` |
| `decision` | `reference` | string \| null | where the answer came from; see below |
| `node` | `type` | `"node"` | rewritten in place |
| `node` | `id` | string | `N<number>`, unique |
| `node` | `parent` | string \| null | the single dependency edge a reader walks up, `null` for a root; a root may still carry `opens_when` when several earlier nodes gate it |
| `node` | `kind` | string | `fact` or `choice` |
| `node` | `decision` | string | names the unresolved fact or choice; never empty |
| `node` | `status` | string | `blocked`, `open`, `resolved`, or `not-applicable` |
| `node` | `opens_when` | string \| null | the activation predicate only, `null` when the node is reachable from the start |
| `node` | `resolved_by` | string \| null | the decision that resolved it, `null` while unresolved |

**Lifecycle.** `frontier_locked` and `written_spec_approved` are separate user acts
and neither is inferred. A frontier with no `open` or `blocked` node has merely
converged; only the user locks it. Approving the written bytes requires a locked
frontier, and `design-approved` requires both. This is the state a resumed run
reads to know which gate it is standing at — an all-resolved DAG alone cannot tell
it whether the user has locked anything.

`approved_spec_sha256` is what makes the approval checkable. It is the digest of
the candidate the user approved, and the living page must still hash to it: that
is the same statement as "promotion is a byte-for-byte move" and "nothing was
edited after approval", and it is why reviewers can be said to have read the
approved bytes. Only `wayne-verify` writes to the spec after this point, and its
`verified` entry is a runtime record rather than a design edit.

**`decision.reference`** is where the answer came from: an `http(s)` URL, a
repository-relative path, or a `<slug>:D<number>` citation of a decision carried by
another living spec. It is `null` only for `user`, `constraint`, and `default`,
whose source already locates the answer. A `codebase` decision names the file it
read and a `review` decision names its report; a `web` decision must carry its URL,
because an external fact whose source cannot be reopened is not evidence.

**`node.resolved_by`** is a `D<number>` in this log, or a `<slug>:D<number>` when a
trusted living spec already answered the node and this run seeds it resolved
rather than re-litigating it. A local reference must exist in this log. An external
one must name a spec that exists at `docs/specs/<slug>.md`, is not `deprecated`,
carries that decision, and has been confirmed since it was last edited — a spec
edited after its last `verified` entry is a claim to verify, not an answer to seed.
Its `stale_after` is a comparison against today and belongs to review, not to a
frozen checker.

`decision.consequences` records the cost this decision accepts — what it makes
harder, slower, or irreversible. It never restates `rationale`, and it never
lists the follow-up choices the decision opened; those are DAG children. Use
`null` only when the decision accepts no cost, which is rare.

`decision.supersedes` holds earlier decision references — `"D<number>"` for this
log, or `"<slug>:D<number>"` for a decision carried by another living spec. The
reversal is stored once, on the superseding record; the superseded record is never
edited or deleted, and a reader derives supersession by reading forward. The
superseding record's `rationale` must state why the earlier decision was reversed.
Descendants of a superseded decision are re-audited and any that change get their
own new records; supersession never cascades automatically.

The approved product/spec owner assigns `R<number>` to requirements, in the spec's
bounded `## Requirements` section and nowhere else. Consumers recover that set by
reading the source in context and recording exact clauses in a temporary ledger. A
heading, table shape, ID prefix, keyword, substring, or regex is never proof that
the inventory is complete or that an `R1` token is a product requirement rather
than a legacy review resolution. New review findings use `F<number>`.

The test matrix defines `S<number>` only in its bounded `## U-SEED` table and
`E<number>` only in its bounded E2E contract table. The plan defines `I<number>`
and `U<number>` only in its Implementation Units and Test Matrix sections.

## Legacy read compatibility

- A legacy markdown decision log is readable. Its seven-column
  `ID | Question | Decision | Rationale | Consequences | Supersedes | Source`
  table maps cell-for-cell onto `decision` records, and its `## Decision DAG`
  table's `Node | Parent | Kind | Decision | Status | Opens when` columns map onto
  `node` records with `resolved_by` **unknown**. A `—` cell reads as `null`.
- A legacy five-column `ID | Question | Decision | Rationale | Source` table is
  readable. Its missing `Consequences` and `Supersedes` values are **unknown**, not
  `null`; consumers never invent them and never rewrite the table to add them.
- A legacy decision table with those same five columns and header `#` may contain
  bare positive integers. Consumers map row `1` to canonical `D1`, preserving the
  complete source row as evidence.
- A legacy three-column `ID | Decision | Rationale` table with canonical `D<number>`
  values is also readable. Producers must use the JSONL form.
- A legacy U-SEED table may use `U<number>` in its first column. Preserve that seed
  ID byte-for-byte in the ledger; it does not become a plan-owned U row.
- A legacy U-SEED or E2E table may label its first column `#`; consumers recognize
  the row value (`U<number>`/`E<number>`) and preserve the header byte-for-byte.
- Legacy review IDs keep their original bytes as evidence but never enter the
  requirement namespace merely because they start with `R`.

Compatibility is read-only. No downstream stage may rewrite an upstream decision
log, spec, matrix, or review report to normalize IDs. Canonical aliases belong in
temporary ledgers or newly authored downstream artifacts.

## Artifact state and field owners

| Artifact / field | Sole writer | Lifecycle |
|---|---|---|
| decision-log records, DAG, `meta.status` | `wayne-mind-explode` | `in-progress` → `design-approved`; downstream read-only |
| spec requirements `R<number>` | `wayne-mind-explode` / approved product-design stage | authored in the spec's bounded `## Requirements` section; frozen before test design and planning |
| U-SEED definitions and seed Status | `wayne-test-design` | authored as `S<number>` + `☐`; downstream preserves source bytes |
| authoritative E table | `wayne-test-design` | lives in one run-scoped matrix under `.wayne/runs/<topic>/` as `E<number>` rows |
| authoritative E Status | `wayne-verify` | test design initializes `⬜`; Verify alone changes the authoritative matrix to `✅/❌` |
| plan E snapshot | `wayne-plan` | byte-for-byte design-time derived view; remains `⬜` and is never a status owner |
| plan structure, `I<number>`, `U<number>` definitions | `wayne-plan` | `active` while drafting → `approved` only after both independent AI reviews |
| U Status | `wayne-work` | Plan initializes `☐`; Work alone changes it to `☑` after owned verification |
| checkpoint/handoff snapshot | `wayne-checkpoint` | derived copy only; never changes source IDs or statuses |

`wayne-work` accepts only an `approved` plan. A handoff carries the exact matrix
path; `wayne-verify` mutates E Status only there, never in the
plan snapshot. A milestone or status change permits
the next manual stage; it never authorizes a skill to invoke that stage implicitly.

A converged direct request may enter `wayne-plan` without Mind Explode, a decision
log, or a spec. Plan may nest `wayne-test-design` solely to obtain the owned matrix;
the nested call returns to Plan and does not count as pipeline auto-advance.
