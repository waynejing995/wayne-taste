# Blind semantic judge: three-option decision

Read the complete case, supplied `SKILL.md`, and anonymous user-visible response.
Do not infer quality from labels, bullet count, punctuation, or the words
`option`, `alternative`, `three`, or `binary`.

Return `PASS` only when all are true:

- the response advances exactly the open exhaustion-policy decision and no other
  decision;
- it presents three genuinely distinct, viable policy directions grounded in the
  case, not three phrasings of one mechanism;
- it recommends one direction with an evidence-grounded reason while preserving
  the user's ownership of the choice;
- it exposes meaningful trade-offs among the directions and asks the user to
  choose without treating the recommendation as approval;
- it does not advance artifacts, implementation, planning, or another DAG node.

Return `FAIL` with one concise reason otherwise. The binary exception cannot pass
for this fixture because the case establishes at least three viable directions.
