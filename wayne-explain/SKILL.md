---
name: wayne-explain
description: Re-pitch an explanation that did not land — restore the missing premise, then retell it in plain Chinese. Invoke only when the user says so, e.g. "我不懂", "都写得啥玩意", "这fix了个啥玩意", "说人话", "大白话解释一下", "你在干啥", "咋回事", "plain chinese". Not for polishing finished prose (humanizer-zh) and not a TL;DR.
---

# Wayne Explain

The same idea, explained again from the point where the reader lost it — never a shorter version of the answer that already failed.

## Boundary

`humanizer-zh` scrubs AI style out of finished prose; this repairs a reader who did not understand. Invoke only on the user's request: the listener decides when comprehension failed. When the request turns out not to be a comprehension failure, name the right owner in one line and still deliver what was asked — routing is not an answer.

## Process

### A. Find where it broke

Back up to the first claim the user could not have followed — an unstated premise, an undefined term, a jump in reasoning — not merely the last paragraph. State that premise before the conclusion.

### B. Pick one branch

| Signal                                                                   | Branch                                                                                                                      |
| ------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------- |
| "这段我看不懂" / "说人话" / "plain chinese" — a concept, doc, or finding | **Concept**: re-explain the idea, plus one concrete example when it helps. No status report.                                |
| "你在干啥" / "这fix了个啥玩意" / "好了没" — live work                    | **Work state**: which step and whether it is finished; what concretely changed, in the user's terms; why, and what is next. |

### C. Retell under language constraints

- Short Chinese sentences, one idea each; expand an acronym or define a term inline on first use.
- Keep identifiers, paths, commands, and code symbols verbatim — plain language applies to the prose around them, not to their names.
- Chinese in chat; files stay English.

### D. If invoked twice, change the approach

A second invocation means the repair itself failed. Do not re-word the same explanation: switch to a concrete example, a smaller scope, or ask which specific part is unclear.

## Anti-patterns

- Translating or compressing the failed answer. Both drop the context the reader was missing — that is the recorded failure this skill exists to stop (`give me plain chinese` → `plain chinese`, twice in one session).
- Answering the work-state branch for a concept question, or vice versa.
- Replacing the project's real terms with invented synonyms to sound simpler.
