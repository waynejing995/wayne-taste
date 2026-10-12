# Instruction prose

The agent that reads a skill cannot ask the author what a sentence means. ASD-STE100 Simplified Technical English (STE) is a controlled language for readers in the same position. This reference adapts the STE sentence rules to skill prose. It is a drafting standard, not a lint gate. Rule numbers refer to STE Issue 9 (2025).

## Scope

The rules fit text that tells the agent what to do. They do not fit text that teaches the agent how to judge. Choose the rules by the function of the text:

| Text function | Where it appears | Rules |
| --- | --- | --- |
| Instruction: tells the agent what to do | procedure steps, gates, Flowchart node details, router selection and no-match paths, playbook procedures, a lens `Rule:` line | 1–10 |
| Rationale: explains why, or teaches a judgment | a lens `Why:` line, contrasting cases, principle and philosophy sections, the reason after a gate | 1 and 7 only |

Rationale carries the reason that generalizes to cases the skill does not list. Do not split it into imperatives, cut it to a word limit, or remove its qualifications. Keep rules 1 and 7, because a term or pronoun that changes between sentences makes the reader see a second concept.

Treat the items that follow as quoted material. Keep them unchanged, as STE 1.14 does for quoted text:

- User trigger phrases in `description`.
- Commands, code, paths, schemas, and exact literals.
- Examples and templates that show an output shape.

Domain terms are allowed as technical nouns and technical verbs (STE 1.5–1.13), for example `rebase`, `frontmatter`, and `bwrap`.

## Rules

1. **One name per concept.** Choose one term for each object or action, and use it every time. A list of user phrasings in `description` is quotation, not synonym rotation (STE 1.11, 9.4).
2. **One action per step.** Write each step as an imperative sentence. If a sentence contains two actions, split it. This includes two clauses joined by a semicolon (STE 5.2, 5.3, 8.1).
3. **Condition before command.** Write "If X, do Y." Do not write "Do Y if X." (STE 5.4). A restriction is different: keep "Do Y only if X." If you rewrite it as "If X, you may do Y", a required condition becomes a sufficient one, and Y without X is no longer forbidden.
4. **One strength per modal word.** Use the imperative or "must" for a requirement, "do not" for a prohibition, and "may" for a permission. Do not use "should" or "can" to state a requirement (STE 1.3, applied to modal verbs).
5. **Every gate states its reason or consequence.** The reason replaces capital letters as emphasis (STE 7.3).
6. **Notes give information only.** Put each instruction in a step or a gate (STE 5.5).
7. **Named referents.** If a pronoun can refer to two nouns, repeat the noun (STE GR-3, GR-4).
8. **Active voice with a named actor:** the agent, the user, or the script (STE 3.6).
9. **Full sentences in steps.** Keep the subject, the articles, and the verb. Table cells, list fragments, and Flowchart labels can be fragments (STE 4.2, 4.3).
10. **Short sentences.** Use approximately 20 words for an instruction sentence. This limit is a review signal, not a gate (STE 5.1).

A skill can contain both functions. A procedure skill often has a principle section, and a lens skill has a `Rule:` line in each principle. Apply the row that matches each sentence, not one row for the whole skill.

A style rewrite of an existing skill must not change what any sentence requires. After the rewrite, have an independent reviewer compare the old and new text for each requirement: dropped, weakened, strengthened, or changed in scope.

## Not adopted

- **The STE dictionary** (approximately 900 approved words, one part of speech for each word). Redistribution of its text needs written permission from ASD, and its effect on model readers is not tested. Rule 1 controls vocabulary instead.
- **Word counts or regex as correctness gates.** The forge red line applies: a lexical rule never decides prose meaning.

## Open hypotheses

Public STE skill benchmarks measure whether output obeys STE. They do not measure whether agents complete tasks better when they read instructions written in STE. Treat each item that follows as a hypothesis. The forge eval can confirm or reject it:

- Full sentences (rule 9) use more tokens than telegraphic prose. The effect on behavior is not known.
- Rules 2, 9, and 10 can remove nuance from rationale. The scope table excludes rationale from these rules, but this exclusion is a judgment, not a measured result.
- A change to the wording of `description` can change trigger recall.

If an eval covers one of these hypotheses, write the result in the eval report.
