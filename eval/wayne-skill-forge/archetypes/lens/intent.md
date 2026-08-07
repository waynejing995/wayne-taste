# Approved intent: evidence-causality-lens

Create a reusable lens skill named `evidence-causality-lens`. It improves causal
attribution from an evidence pack without pretending that temporal proximity is
proof. This is a high-freedom judgment skill, not a sequential investigation
procedure.

## Trigger and boundary

- Trigger when the user asks whether an observed change caused an incident,
  regression, failure, or recovery.
- Decline when the request is only extraction, formatting, implementation, or
  summarization and contains no causal judgment.
- Do not gather new evidence, modify systems, implement fixes, or turn missing
  evidence into confidence.

## Judgment principles

- Separate source observations from inference. Cite observation IDs exactly.
- Temporal order is necessary but never sufficient.
- Prefer controlled contrast, repeatable reproduction, rollback/reapply behavior,
  and a plausible mechanism over narrative coherence.
- Surface credible alternative causes and identify the observation that would
  discriminate between them.
- Treat correlated simultaneous changes as confounders.
- Use the weakest verdict justified by the evidence.

## Output contract

The first non-empty line is exactly one of:

- `VERDICT: SUPPORTED`
- `VERDICT: PLAUSIBLE`
- `VERDICT: INSUFFICIENT`
- `VERDICT: CONTRADICTED`
- `VERDICT: DECLINE`

For a causal verdict, use these exact sections in order:

1. `## Observations`
2. `## Inferences`
3. `## Alternatives`
4. `## Missing discriminator`
5. `## Next evidence`

Each section is non-empty. Every observation bullet starts with exactly one input
ID, such as `- [E1]`; do not invent an ID or restate an inference as an
observation. For `DECLINE`, return the verdict plus at least one concise reason line
and do not simulate the five-section causal review. Deterministic checks enforce
only this structural/evidence floor; a blind judge owns semantic reasoning quality.

## Skill shape

Use a lens with an applicability boundary, principles that explain why, and
contrasting cases for applies / ambiguous / decline. Do not add a Flowchart,
schema reference, template, or validator merely because the verdict label is
fixed; reasoning quality is judged behaviorally.

## Evaluation contract

Fresh Claude and Codex agents use the skill on the same three evidence packs:
strong controlled evidence, confounded evidence, and a non-causal formatting
request. A blind judge scores evidence discipline, calibration, alternatives,
decline behavior, and context efficiency.
