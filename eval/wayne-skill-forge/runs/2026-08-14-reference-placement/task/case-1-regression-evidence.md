# Case 1 — exact regression evidence

This is the evidence as it was actually supplied on 2026-08-14, when the control forge produced a skill with zero references. It deliberately contains no hint that any material is conditional, because the original did not. Adding such a hint is what invalidated the first attempt at this eval: it told both arms the answer.

Author a skill for deep-reading an unfamiliar codebase and producing an engineering report whose citations are verified.

## Trigger phrases

Should trigger: "study this repo", "read dsh and write a report", "what can we learn from project X", "深读这个仓库", "写份调研报告".
Should not trigger: diagnosing a specific failure; reviewing a diff the user wrote.

## Local facts the model cannot infer

- A shallow clone answers `1` to every history question without erroring. `git fetch --unshallow` fails with `early EOF` on large repositories; `--filter=blob:none --unshallow` succeeds.
- Total commits and first-parent commits answer different questions. Mixing them produced a false velocity claim.
- Read-tool line counts differ from `wc -l` by one; counts taken from truncated output were wrong by 30% (69 reported as ~90).
- A one-word paraphrase drift inverted a load-bearing claim: the source says `no provider forks`, the report said "no consumer forks".
- A verification section that counts its own citations drifts on every edit; the count contradicted itself three times before being excluded.
- Repository documentation was wrong about its own code in two places, and finding that was the highest-value paragraph in the report.
- A claim can be documented, implemented, and unenforced at the same time; a "100% coverage" gate excluded whole trees; an "invariant asserts it" gated on a marker only one call site set.
- Recommending deletion of an unused extension point was wrong: a decision record said the mechanism was deliberately open.

## Baseline failures the skill must correct

1. Quoting history facts from a shallow clone.
2. Reporting a count taken from truncated command output.
3. Paraphrasing a load-bearing sentence instead of copying bytes.
4. Claiming "every factual claim is verified" when only citations were checked.
5. Letting the verification section verify itself.
6. Recommending deletion without searching for a decision record.

## Available operational and situational material

Reading a large repository requires dispatching parallel read-only sub-agents, each with an evidence contract, across axes chosen per repository. Citation checking is mechanical and was performed by hand six times during the original session. Report structure, the claim-strength audit, and the boundaries section each have their own rules.

## Output

An engineering report: snapshot header, findings with `path:line` citations, corrections made during the work, contradictions found in the subject's own documentation, and an explicit statement of what was not read and not executed.
