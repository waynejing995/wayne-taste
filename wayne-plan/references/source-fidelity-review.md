# Source-fidelity review protocol

Use this protocol only for the independent semantic review after deterministic
validation. The plan contract owns the requirements; this review judges meanings
that the validator cannot prove.

## Source-to-ledger review

Read every upstream artifact completely. Build an independent obligation list
without seeing only the ledger's selected rows, then reconcile it against the
ledger in both directions. For each source clause, record whether it is a product
requirement, decision, review finding, rationale, example, or non-normative
context, with the surrounding evidence that determines that classification.
Missing or misclassified obligations fail the review.

Do not use headings, table shape, ID prefixes, keywords, substring search, or
regex as a completeness or semantic-equivalence oracle. They may locate text,
but contextual reading owns classification. A source can express a requirement
under an unexpected heading, and an `R1`-shaped review finding can remain a
finding.

## Seed-by-seed review

Read the original matrix, source ledger, approved decision log/spec, repository,
and unmodified plan. For every ledger seed, independently:

1. Read its complete `exact` source row in context. State its accepted behavior,
   rejected behavior, boundary classes, order or state timing, quantities,
   modality or negation, and other qualifiers that affect observable behavior.
2. Locate its one plan disposition: the mapped U scenario or `Dropped Seeds`
   reason. Compare behavior sets and qualifiers, not shared words. Moving the
   behavior to a real unit surface or paraphrasing it is allowed only when the
   obligations remain equivalent.
3. For a drop, require approved source and repository evidence that no U scenario
   is warranted, and identify where the behavior remains carried or why it no
   longer applies. Convenience, duplication, or low priority alone does not
   justify losing an obligation.
4. Emit one report item with the seed ID, its exact row, disposition, preserved
   semantic obligations, evidence, and `PASS` or `FAIL`. Explain every failure as
   a specific narrowing, widening, normalization, omission, or qualifier change.

Any seed failure fails the source-fidelity review. Return the plan to revision,
then re-run deterministic validation and both independent reviews. Do not infer
semantic equivalence from seed identity, similar vocabulary, or validator success.

## Behavioral review fixtures

Use these paired fixtures to evaluate reviewer behavior, not as lexical rules.
Equivalent paraphrases should pass; behavior-set or qualifier changes should fail.

| Exact source seed | Candidate disposition | Expected judgment |
|---|---|---|
| Reject blank request fields before state mutation. | An empty or whitespace-only field → validate before calling the store → reject it and leave records/indexes unchanged. | PASS: preserves the rejected boundary class and mutation timing on a real surface. |
| Reject blank request fields before state mutation. | Each field equal to the empty string → call submit → reject it with an unchanged store. | FAIL: narrows “blank” to empty strings and omits whitespace-only values. |
| Accept at least one approver. | One or more approvers → submit approval → accept it. | PASS: preserves the lower bound. |
| Accept at least one approver. | Exactly one approver → submit approval → accept it. | FAIL: narrows “at least” to “exactly.” |
| Reject negative quantities. | A quantity below zero → validate it → reject it. | PASS: preserves the boundary. |
| Reject negative quantities. | A quantity at or below zero → validate it → reject it. | FAIL: widens the rejected set to zero. |
| Record the audit event before publishing. | A valid change → append its audit event, then publish → observers never see publication first. | PASS: preserves ordering. |
| Record the audit event before publishing. | A valid change → publish, then append its audit event → both eventually occur. | FAIL: changes before to after even though both actions remain. |
| Never persist raw tokens. | Any success or failure path → store derived metadata only → no raw token is written. | PASS: preserves universal negation. |
| Never persist raw tokens. | A normal request → usually redact the token before storage → most rows omit it. | FAIL: weakens never to usually. |
| Reject calls to the retired v1 endpoint. | Drop: approved decision D4 removes the endpoint and repository tracing confirms no v1 callable remains; D4’s deletion unit and absence verification carry the obligation. | PASS only when the cited sources and plan prove the endpoint is unreachable and the behavior was not silently omitted. |
| Reject calls to the retired v1 endpoint. | Drop: duplicate or low priority. | FAIL: the reason does not preserve or retire the required behavior. |
