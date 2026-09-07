# wayne-explain slimming eval

## Approved intent

Keep one short, explicitly requested explanation skill. Restore missing context in plain Chinese rather than merely shortening a failed answer. Preserve real project names. Support the requested ELI level or audience without separate skills or mandatory HTML output. Accept a leading number as the level and reuse the current topic when none follows. Default to `25`: explain mechanisms and trade-offs to an adult without assuming specialist knowledge. Define `5`, `10`, and `15` explicitly rather than relying on familiarity with the ELI abbreviation.

This is a slimming comparison, not an exact historical failure reproduction. Cases are synthetic. The original work-status and repeated-confusion behaviors remain regression observations; there is no requirement to preserve their old headings or routing instructions.

## Run

Use the existing filesystem-isolated runner. Freeze this directory and snapshot each skill before execution. Put snapshots, checksums, workspaces, traces, and identity mappings under gitignored `eval/.runs/wayne-explain/`.

```bash
MODEL=<exact-model> EFFORT=high bash eval/wayne-explain/run.sh <skill-directory> <fresh-output-directory>
```

Run once per version with identical model and effort. Each case starts a fresh agent that can see only its supplied skill and task, not the rubric, other version, or prior outputs. The run also includes a metadata-only trial for explicit triggers and adjacent non-triggers.

## Frozen semantic rubric

A blind reviewer reads the task and complete answers, not version identity. Judge meaning, not keywords, formatting, or a numerical word limit:

- `default25`: continue the current database-index topic without asking for an age or topic; explain the mechanism and a meaningful trade-off for an adult without assuming specialist knowledge.
- `bare5`: interpret the leading `5` as a level, not the topic; continue explaining database indexes with simple words and an everyday example.
- `bare15`: interpret the leading `15` as a level, not the topic; explain the index mechanism and define unfamiliar terms rather than using only a child's analogy.
- `concept`: explain why separate dashboard copies can disagree; distinguish one authoritative status from read-only views. Do not turn a concept explanation into a work report.
- `work`: explain the visible timezone bug and change; preserve `created_at`, `Asia/Shanghai`, and the code path when mentioned. Unit checks passed but deployment and production verification have not happened. Do not invent completion or next work already performed.
- `retry`: the earlier jargon-heavy repair failed. Make the two-copy disagreement concrete instead of merely compressing the same jargon.
- `eli5`: give a short, concrete account of a database index for the explicitly requested beginner level, without implying indexes copy the whole database or make every query free.
- `eli25`: explain a database index to a backend engineer, including the mechanism and at least a meaningful trade-off, without childish framing or unsupported guarantees.
- `triggers`: the comprehension request and explicit ELI5/ELI15/ELI25 requests should activate the skill; a request solely to polish prose or produce a TL;DR should not. Plain technical explanation without a simplification/audience request should not automatically activate it.

Score task success, boundaries, output, control flow, resource use, and context efficiency as 0/1/2 using `wayne-skill-forge/references/eval.md`. Record paired win/tie/loss/invalid and concrete evidence. A correctness or boundary regression blocks acceptance. Infrastructure failures are invalid, not skill failures. Smaller prompts win only when required behavior is preserved; these few cases cannot establish general reliability.

## Coverage and resource placement

Explicit invocation and adjacent-task exclusions belong to metadata. Missing context, Chinese, audience calibration, the default and numeric argument contract, brevity, real names, and optional examples belong to the short body. Work-status truthfulness and repeated-confusion repair are checked through behavior rather than a routing table. Global engineering rules stay global. No reference: there is no long conditional material needed at runtime.

## Sources

- The current local skill supplies the control behavior.
- `mattpocock/skills`, commit `3cca18b368ae95cdbdebbff572ccafa662551015`, `skills/productivity/wait-what/SKILL.md`: a one-paragraph comprehension-repair prompt.
- https://eli5.cc/: the observed homepage offers ELI5, ELI10, ELI15, and Expert depth levels. It is not evidence of an ELI25 implementation.
- https://dev.to/gridport/claude-codes-eli5-skill-explained-how-it-works-setup-and-when-to-use-it-c6 quotes a short HTML-oriented prompt. The linked `DreambigOu/ELI5` repository at `a766623b062331fdde53467001379b4ddf3acc2f` instead contains a longer audience-calibration skill. Neither HTML output nor that long audience table is part of this revision.
