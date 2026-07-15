# Contract protection

Use this when the forged skill produces an artifact whose correctness depends on
structure or relationships, not prose quality. The goal is the smallest complete
contract, not the shortest file.

## Contents

1. Classify contract density
2. Map requirements to owners
3. Freeze literal fidelity
4. Bind oracle inputs
5. Choose the minimum resource floor
6. Keep one schema owner
7. Prove the validator
8. Compress safely

## 1. Classify contract density

Each signal lowers the allowed freedom:

| Signal | Example | Risk without a guardrail |
|---|---|---|
| exact grammar | fixed headings, table columns, status prefix | plausible but unparsable output |
| cross-field reference | unit dependency, producer/consumer, trace ID | locally valid rows that disagree |
| unique owner | one U row or state has one owner | duplicated or orphan state |
| verbatim carry | E rows, legal text, source query | silent drift from the source |
| ordered dependency | migration or implementation units | correct steps in an unusable order |
| machine terminal | `BLOCKED`, `PASS`, exit code | prose before or instead of the contract |

No signal: prose guidance may be enough. One signal: use a positive template.
Two or more signals: use a direct contract reference, canonical template, and a
deterministic validator unless the invariant is genuinely semantic.

Do not fake determinism for judgment tasks. A lens with multiple valid conclusions
needs contrasting cases and behavioral eval, not a keyword checker.

## 2. Map requirements to owners

Create this working table before drafting; delete it before delivery:

| Requirement | Failure if omitted | Single owner | Proof |
|---|---|---|---|
| `<approved clause>` | `<observable failure>` | body / reference / template / validator / eval | `<check>` |

Rules:

- Every approved clause has one owner and one proof.
- Split independent directions and relationships into separate rows even when they
  share a topic. “Completeness” does not prove reverse ownership consistency.
- A template instantiates a schema; it does not independently redefine it.
- A validator checks the schema; it does not become a second documentation source.
- An eval exercises behavior; it does not compensate for a missing contract.
- An orphan row blocks compression.

## 3. Freeze literal fidelity

Create a temporary ledger for clauses whose spelling or cardinality is behavior:

| Source clause | Mode | Exact value or invariant | Mutation proof |
|---|---|---|---|
| `<intent location>` | literal / semantic / verbatim | `<frozen rule>` | `<minimal break>` |

Freeze these before drafting resources:

- quoted or backticked grammar, headers, prefixes, sentinels, and statuses;
- `exactly`, `at least`, `at most`, unique-owner, and no-extra alternatives;
- verbatim carry and ordering requirements;
- forbidden fallbacks, drop paths, and stop conditions.

Literal and verbatim clauses copy byte-for-byte. Semantic clauses may be restated
only when their accepted and rejected sets stay identical. Do not turn `none` into
`- none`, “exactly once” into “mapped or dropped”, or a three-part scenario grammar
into “non-empty”. Delete the ledger after validation, not before.

After drafting, trace from intent → schema → template → validator in both directions.
Agreement among the three downstream resources is insufficient when all three
share the same drift.

When exact content arrives only when the forged skill runs, make that skill build
the same ledger temporarily from its actual sources before authoring. Include
quoted/backticked literals, explicit quantities and states, ownership claims, and
forbidden alternatives. Trace every runtime row to an output location and a proof;
do not reduce source fidelity to “the source ID appears somewhere.”

### Contradiction gate

Compare clauses that govern the same field or transition. If they accept different
sets — for example “every seed maps to a row” versus “a seed may be dropped” — stop.
Report both source locations and ask the upstream owner to set precedence or rewrite
one clause. Specific-looking wording does not silently override another approved
clause unless the intent defines that precedence.

Do not forge a validator that chooses a side; it converts an input defect into a
false deterministic truth.

## 4. Bind oracle inputs

Classify every invariant by what the checker must observe:

| Invariant | Oracle input |
|---|---|
| section order, local grammar, internal references | generated artifact |
| verbatim row or source query | artifact + original source |
| every source record accounted for | artifact + source collection |
| exact source literal or ownership claim | artifact + original source |
| real path and symbol | artifact + repository tree |
| no upstream mutation | before/after repository manifest |
| downstream executability | sanitized repo + artifact + hidden acceptance |

A validator must accept every oracle input needed by the invariants it claims.
Never label a plan-only validator as proof of source fidelity, completeness, or real
repository surfaces. Keep semantic review separate when an invariant cannot be
checked deterministically.

Mutation proofs alter both sides when relevant: delete a source record, change a
verbatim row, point to a missing symbol, or mutate the generated mapping. Test each
direction independently. A checker that sees only one side cannot prove a two-sided
relationship.

## 5. Choose the minimum resource floor

| Contract shape | Required resources |
|---|---|
| flexible prose or judgment | body or direct reference plus contrasting eval cases |
| exact local output shape | schema reference plus canonical template |
| cross-record or referential invariants | schema reference, template, deterministic validator |
| repeated state mutation or destructive sequence | deterministic script plus approval and verification gates |

The floor is about freedom, not skill size. A 100-line skill can need a validator;
a 250-line lens may not.

## 6. Keep one schema owner

Put field names, grammar, allowed values, and relationships in one direct reference.
Make the body say when to read it and when validation is mandatory. Keep the
template obviously aligned with it. Implement validator errors in the same terms.

When the three disagree, stop and fix ownership before running behavioral eval.
Do not let examples introduce an alternative valid shape.

## 7. Prove the validator

For every bundled validator:

1. Run a known-valid fixture assembled from the frozen literals; require exit zero.
2. For every independent machine-checkable invariant in the ledger, change one
   thing and require non-zero plus the intended finding. Test both directions of
   ownership/cross-reference rules separately; a family-level mutation is not
   coverage for its siblings. Cover literal/sentinel, cardinality/owner,
   cross-reference/order, verbatim carry, and forbidden alternatives when present.
   Prefer one table-driven mutation harness; proof granularity does not require a
   separate model or tool turn for every row.
3. Run the repository's configured lint or static check.
4. Run the validator on the actual generated artifact before downstream execution.
5. Run a frozen external checker or acceptance set authored before generation.
   Trace each external finding to an explicit published contract clause. Remove an
   evaluator-only expectation instead of treating it as a candidate failure.

Inspection is not execution. If the environment cannot run the script, validation
is incomplete and the skill cannot claim a static pass.

Keep fixtures outside the shipped skill unless downstream users need them. Eval
fixtures must remain hidden from test agents until their run ends.

## 8. Compress safely

Delete decoration and duplicated explanation first. Move detailed schema text to
the direct reference. Keep only routing, gates, resource-loading conditions, and
verification in the always-loaded body.

Do not compress away:

- failure and stop terminals;
- ownership and referential-integrity rules;
- exact output or status contracts;
- retry, resume, timeout, and uncertain-state semantics;
- the command or observable evidence that proves completion.

Accept a larger candidate when removing any of these causes a real regression.
Context efficiency is a tie-breaker only after contract correctness.
