# Wayne plan contract

This file owns the plan, blocker, runtime-ledger, and validator-input schemas.
`_shared/pipeline-id-contract.md` solely owns cross-stage identifier namespaces.
The template instantiates both contracts; the validator checks them.

## Contents

1. Inputs and temporary evidence
2. Plan file and frontmatter
3. Section grammar
4. Requirement and unit relationships
5. Test Matrix ownership
6. Content constraints
7. Blocking artifact
8. Validator interface and proof boundary

## 1. Inputs and temporary evidence

A successful plan check receives:

- the new plan;
- repository root and a pre-authoring manifest of every repository file except `.git` internals;
- the original test matrix;
- every available original decision log and spec; and
- an exact temporary request snapshot when neither of those contains the direct request; and
- a temporary source ledger made from those exact sources.

Place the manifest and ledger outside the repository root. Do not ship either. The matrix is mandatory. A decision log or spec is optional only when it did not exist at discovery time.

Create the manifest before writing the plan:

```bash
uv run --no-project <skill-dir>/scripts/validate_plan.py snapshot \
  --repo-root <repo> --output <temporary-manifest.json>
```

The source ledger is UTF-8 JSON with this shape:

```json
{
  "version": 1,
  "sources": {
    "decision_log": "docs/decisions/2026-01-01-topic-decisions.md",
    "spec": "docs/specs/2026-01-01-topic-design.md",
    "matrix": "docs/test-matrix/2026-01-01-topic.md",
    "request": null
  },
  "source_sha256": {
    "docs/decisions/2026-01-01-topic-decisions.md": "<sha256>",
    "docs/specs/2026-01-01-topic-design.md": "<sha256>",
    "docs/test-matrix/2026-01-01-topic.md": "<sha256>"
  },
  "requirements": [
    {"id": "R1", "source": "docs/specs/2026-01-01-topic-design.md", "exact": "R1. <complete source line>"}
  ],
  "decisions": [
    {"id": "D1", "source": "docs/decisions/2026-01-01-topic-decisions.md", "exact": "D1. <complete source statement>"}
  ],
  "u_seeds": [
    {"id": "<exact first-column seed identifier>", "exact": "<complete source Markdown data-row line>"}
  ],
  "e_contract": {"exact": "<complete E table or E2E: none — reason>"}
}
```

Use JSON `null` for an absent `decision_log`, `spec`, or direct request snapshot, and omit its hash and entries. When a request snapshot is supplied, set `request` to identifier `direct_request`, add that identifier to `source_sha256`, and use it as the relevant entry `source`. Preserve each `exact` value byte-for-byte. Apply `_shared/pipeline-id-contract.md`: contextual source-fidelity review determines which clauses are requirements, decisions, or findings; canonical decisions are `D<number>`. A legacy numeric decision-table row `1` is ledger ID `D1` with the original numeric row in `exact`. Never rewrite a source to add a prefix.

The ledger is an AI-authored contextual inventory, not parser output. Headings,
table shape, ID prefixes, keywords, regex, and substring scans may help navigate a
source but cannot prove semantic classification or completeness. Both independent
reviews must reverse-audit source → ledger → plan. The deterministic validator
only checks source hashes, literal existence, ledger grammar, and downstream
closure over the ledger it was given.

Locate exactly one level-two `## U-SEED` section in the matrix and exactly one Markdown table within that bounded section. Each data row after its header and separator is one source seed. Its identifier is the non-empty, unique first-cell value exactly as written after Markdown cell-padding is removed; `added` is reserved and cannot be a source identifier. Store that identifier as `id` and the complete source Markdown data-row line, excluding its line ending, byte-for-byte as `exact`. Do not discover seeds from prose or tables outside that section. The validator independently inventories this structured table, checks all source hashes, and requires the ledger identifiers and exact rows to equal it in both directions. Independent source-fidelity review remains responsible for seed-by-seed semantic equivalence, which has no machine grammar.

## 2. Plan file and frontmatter

Write English Markdown to:

```text
docs/plans/YYYY-MM-DD-NNN-<feat|fix|refactor>-<3-5-word-name>-plan.md
```

Use a three-digit daily sequence and a three-to-five-word lowercase kebab name. The frontmatter has exactly these keys in this order:

```yaml
title: <non-empty title>
type: <feat|fix|refactor>
status: active
date: YYYY-MM-DD
origin: <repo-relative source path or none — converged direct request>
decisions: <repo-relative decision-log path or none — no decision log exists>
```

The filename date and type equal frontmatter `date` and `type`. Source paths are repository-relative and must name the supplied sources. The file is new relative to the pre-run manifest. Status is `active` while drafting; only both independent review passes authorize changing it to `approved`. `wayne-work` accepts only `approved`.

## 3. Section grammar

Use each level-two section exactly once and in this order, with no additional level-two section:

1. `## Overview`
2. `## Problem Frame`
3. `## Requirements Trace`
4. `## Scope Boundaries`
5. `## Context`
6. `## Key Technical Decisions`
7. `## Open Questions`
8. `## File Structure`
9. `## Implementation Units`
10. `## Test Matrix`
11. `## Dead Code / Legacy Cleanup`
12. `## System-Wide Impact`
13. `## Risks & Dependencies`
14. `## Sources & References`

`## Requirements Trace` starts with exactly:

```markdown
| Requirement | Owning units |
|---|---|
```

Each data row is `| R<number> | I<number>[, I<number>...] |`. Every ledger requirement occurs exactly once and owns at least one existing unit. The unit’s `Requirements` field and this table agree in both directions.

`## Implementation Units` contains only unit level-three headings. A heading is:

```markdown
### Unit I<number> — <name>
```

Unit IDs are unique and increase numerically in dependency order. Under every heading, use these non-empty level-four fields exactly once and in this order:

1. `#### Goal`
2. `#### Requirements`
3. `#### Dependencies`
4. `#### Consumes`
5. `#### Produces`
6. `#### Files`
7. `#### Approach`
8. `#### Technical design`
9. `#### Patterns`
10. `#### Test scenarios`
11. `#### E rows`
12. `#### Verification`
13. `#### Decision trace`

When a field legitimately has no item, its entire value is exact sentinel `none — <non-empty reason>`. Do not substitute `none`, `N/A`, an empty list, or a placeholder.

## 4. Requirement and unit relationships

- `Requirements` lists one or more ledger `R<number>` IDs, or the exact sentinel when the unit is pure cleanup with no source requirement. Unknown IDs are forbidden.
- `Dependencies` lists only earlier unit IDs and states why, or the exact sentinel for an independent unit. Forward, self, and unknown dependencies are invalid.
- Every non-sentinel `Consumes` bullet has `repo/relative/path::symbol from I<number> — <role>` for an earlier producer, or `repo/relative/path::symbol from repository — <role>` for an existing surface.
- Every non-sentinel `Produces` bullet has `repo/relative/path::symbol — <type/input → type/output and role>`.
- A `from I<number>` surface must exactly equal a surface in that earlier unit’s `Produces` field. A repository surface must name an existing path and symbol.
- Every `Files` bullet is `Create|Modify|Delete repo/relative/path::symbol — <specific work>`. `Modify` and `Delete` paths exist before authoring. Every produced or tested surface is named by the owning unit’s interfaces or files.
- Use the most specific semantic surface consistently. A new field or method is
  `Type.member` in both `Produces` and `Files`, even though that member does not
  exist yet; `Modify` requires the path, not the future symbol, to preexist. Never
  widen `Type.member` to `Type` or strip its owner merely to satisfy equality.
- `Patterns` names existing `path::symbol` surfaces to follow, or uses the exact sentinel.
- `Decision trace` names every decision that drives the unit. Across all units, every ledger decision appears at least once. Use the exact sentinel only when no decision log exists or the unit is HOW-only, with the reason stated.

Backticks around a surface are optional; they do not change its identity. Paths are never absolute, never contain `..`, and always use `/` separators.

## 5. Test Matrix ownership

`## Test Matrix` contains these three items in order.

First, copy the complete E Markdown table byte-for-byte from the matrix, including header, separator, row order, wording, IDs, columns, and every `⬜`. This is a read-only design-time snapshot, not a second Status owner; the authoritative table remains at the linked `docs/test-matrix/` path. If the upstream owner instead declared no E contract, copy its complete line `E2E: none — <reason>` byte-for-byte. The source must contain exactly one of these forms. A table row ID is `E<number>` and each row has status `⬜`.

Second, include one U table with this exact header and separator:

```markdown
| ID | Owner | Seed | Surface | Scenario | Status |
|---|---|---|---|---|---|
```

Each U row obeys all of:

- `ID` is a unique `U<number>`.
- `Owner` is exactly one existing `I<number>`.
- `Seed` is exactly one identifier from the ledger’s `u_seeds`, unchanged from the source table, or literal `added` only when no source seed produced the row.
- `Surface` is one repo-relative `path::symbol` named in the owner’s interfaces or files.
- `Scenario` has exactly `concrete input → action → expected result`; keep both arrow characters.
- `Status` is exactly `☐`.

Re-authoring may change the unit surface and wording, but it must preserve the source seed’s accepted and rejected behavior sets, boundary classes, ordering, state timing, quantities, modality, negation, and every other qualifier. Do not narrow, widen, normalize, or omit those obligations. A drop reason must show from approved sources and repository evidence why no U scenario is warranted without discarding or weakening the seed’s behavior. Source-fidelity review compares each ledger `exact` row with its mapped U scenario or drop reason; any changed obligation fails the review and returns the plan to revision.

Third, include this heading and exact table header:

```markdown
### Dropped Seeds

| Seed | Reason |
|---|---|
```

Every ledger seed identifier appears exactly once across the U table’s `Seed` column and `Dropped Seeds`, never both, and neither table may name an identifier absent from the ledger. A dropped row uses the exact identifier unchanged and a non-empty reason. Literal `added` never appears in `Dropped Seeds`.

Every non-sentinel unit `Test scenarios` field lists its U IDs; every U ID appears in exactly one such field and its table owner matches that unit. A feature-bearing unit has at least one U row. A non-feature unit uses the exact sentinel with its reason.

Every source E ID is listed by at least one unit’s `E rows`; only source E IDs may appear there. When the source declares E2E none, every unit uses the sentinel. `wayne-work` alone changes `☐`; `wayne-verify` alone changes `⬜`. A plan therefore contains no `☑`, `✅`, or `❌` Test Matrix status.

## 6. Content constraints

Unit fields must not contain any banned placeholder, case-insensitively:

- `TBD`
- `TODO`
- `implement later`
- `add error handling`
- `add validation`
- `handle edge cases`
- `write tests`
- `similar to Unit`

Name actual branches, failures, inputs, actions, and expected results. Do not reference an undefined interface. Do not include absolute paths, git commands, commit messages, or runnable framework code. Pseudocode and diagrams are directional guidance only. Do not claim an execution-time unknown is resolved; list it under deferred questions with the exact sentinel only when it does not block WHAT-level behavior.

## 7. Blocking artifact

On an active conflict or absent owned E contract, do not create a plan. Return exactly five non-empty lines and no preamble, code fence, blank line, or validation announcement:

```text
STATUS: BLOCKED
REASON: PLAN_CONFLICT or MISSING_E2E
ARTIFACTS: <semicolon-separated repo-relative paths>
OWNER: product-design or test-design
<one concise Chinese explanation>
```

Choose one reason, not the literal word `or`. `PLAN_CONFLICT` requires `OWNER: product-design`; `MISSING_E2E` requires `OWNER: test-design`. List at least one artifact. The fifth line contains Chinese text and no line break.

Validate a temporary blocker file before returning its unchanged bytes:

```bash
uv run --no-project <skill-dir>/scripts/validate_plan.py check-blocked <temporary-blocker.txt>
```

On success, the command writes the input artifact byte-for-byte to stdout. Pass that stdout through as the entire user-visible response without regenerating or announcing it. On failure, it exits nonzero and prints stable finding codes instead of the artifact.

## 8. Validator interface and proof boundary

Run the successful-plan check as:

```bash
uv run --no-project <skill-dir>/scripts/validate_plan.py check <plan> \
  --repo-root <repo> \
  --pre-run-manifest <temporary-manifest.json> \
  --matrix <repo-relative-matrix> \
  --source-ledger <temporary-source-ledger.json> \
  [--decision-log <repo-relative-log>] \
  [--spec <repo-relative-spec>] \
  [--request-source <temporary-exact-request.txt>]
```

Exit zero proves local grammar and relationships, exact E carry, structured seed accounting, original-source hashes and literal ledger entries, real repository surfaces where claimed, and no repository mutation beyond the new plan. A nonzero exit prints stable finding codes.

Use `--no-project` for every validator subcommand so validation cannot discover, lock, or create an environment for the target repository.

It does not prove source requirement/decision completeness, semantic classification, semantic equivalence, quality of HOW choices, English prose quality, or downstream executability. The two independent reviews own those judgments. Deleting sources, weakening the ledger, or using an artifact-only invocation cannot convert a source-relative failure into a pass.
