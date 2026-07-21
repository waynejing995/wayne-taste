# Evidence File Guide

The single source of truth for one triage. Use this layout as a shared guide at
`<cwd>/.wayne/triage/<date>-<slug>.md`. Named landing information survives context
compression better than an essay, but headings, field order, and table shape are
not a machine schema. Every subagent writes concise evidence into this file, and
the main agent reads the evidence file rather than raw subagent logs.

## Why landing fields, not prose

- A downstream reader (you, next turn, or a subagent) must reconstruct the state from this file cold. Named fields make that reliable; a narrative paragraph does not.
- Fill fields with short, citable values. Push reasoning into the `reasoning` chain and `[INFERRED]` tags, not into long paragraphs.
- Leave a field explicitly `unknown` rather than deleting it — a missing field reads as "not investigated," a filled one as "checked, here's the answer."

## Evidence-strength markers (tag every claim)

- `[OBSERVED]` — verbatim in a log / artifact / repro output. Cite `file:line`.
- `[INFERRED]` — logically derived from observed facts. State the inference.
- `[UNCERTAIN]` — a hypothesis not yet grounded. Never route on an unmarked guess.

Unmarked claims are treated as OBSERVED — so if you didn't observe it, mark it.

## Suggested frontmatter

Use YAML frontmatter when it helps index `.wayne/triage/`. The seen-before check
matches failures by concept, not keyword or exact field presence. Preserve the
meaning below even when an equivalent layout is clearer.

```yaml
---
slug: <kebab-slug>
date: YYYY-MM-DD
surface: <failure | tracker>
symptom_class: <crash | hang | wrong-output | perf-regression | flaky | config-env | bug | enhancement | unknown>
cause_category: <logic | config | dependency | environment | infra-hardware | test-artifact | architecture | unknown>
component: <where the cause was attributed, or unknown>
est_lines: <rough fix size, int>
blast_radius: <internal | shared>
route: <fix-now | test-then-fix | iterate-in-a-loop | needs-plan | escalate-architecture | escalate-incident | route-to-owner | uncertain | needs-info>
repro_count: <how many times this exact root cause has been seen, int>
---
```

## Recommended evidence layout

```markdown
# Triage: <slug>   ·   <date>

## Symptom
- verbatim: "<exact log / error text>"        [OBSERVED] <file:line>
- first_seen: <when it started>
- reporter: <who / what surfaced it>

## Repro
- command: `<exact command>`  |  non-deterministic: <why, + data plan>
- rate: <every time | N of M runs>
- recent_changes: <git log / new deps / config since last-good>   [OBSERVED]

## Classify
- symptom_axis:  <crash | hang | wrong-output | perf-regression | flaky | config-env | bug | enhancement | unknown>
- cause_axis:    <logic | config | dependency | environment | infra-hardware | test-artifact | architecture>
- contributing:  [<other factors — root cause is rarely singular>]

## Signals            # bool flags set in Phase 2 → select the symptom playbook
- stack_trace:   <true|false>
- deadlock_hang: <true|false>
- flaky_pattern: <true|false>
- perf_delta:    <true|false>
- env_skew:      <true|false>

## Boundaries         # multi-component only; one row per layer boundary
| boundary            | data in | data out | verdict |
|---------------------|---------|----------|---------|
| <layerA → layerB>   | <ok?>   | <ok?>    | ✓ / ✗   |

## Hypothesis matrix   # advance by ELIMINATION; any -- kills a hypothesis
| evidence (cite)                    | H1: <cause> | H2: <cause> | H3: <cause> |
|------------------------------------|:-----------:|:-----------:|:-----------:|
| <observed fact> [OBSERVED] f:line  |     ++      |      +      |     --      |
| <observed fact> [OBSERVED] f:line  |     ++      |     n/a     |     n/a     |
legend: ++ strongly consistent · + weakly · -- inconsistent (disproves) · n/a irrelevant

## Attribution        # copy-or-flag, NEVER judge
- symptom_layer:  <where the symptom points>
- cause_layer:    <where Phase 4 confirmed the cause>
- verdict:        <AGREE → responsible=<component> | DISAGREE → UNCERTAIN>
- responsible:    <component>   confidence: <0.0-1.0>
- candidates:     [<A>, <B>]    # when UNCERTAIN, both live here — do not drop one
- reasoning:                    # chain, each step cites its source
  - step: <claim>   observation: <fact>   source: <file:line>

## Route              # the deliverable — present, then STOP for the user
- verdict:    <fix-now | test-then-fix | iterate-in-a-loop | needs-plan | escalate-architecture | escalate-incident | route-to-owner | uncertain | needs-info>
- justified_by: <the citation that forces this route>
- handoff:    <target: owner / loop eval command / incident channel / follow-up issue>
```

## Filling notes

- **Symptom `verbatim`**: paste the log text, do not paraphrase. Paraphrase drifts across turns and breaks grounding.
- **Signals** drive the playbook — set them before Phase 4 so the right deep-dive runs.
- **Matrix** rows are evidence, columns are hypotheses. You eliminate columns; you never "confirm" one directly — the survivor with the strongest `++` and no `--` is the leading cause.
- **Attribution.verdict = DISAGREE** is not a failure of triage — it is an honest result. Routing on a forced agreement is the failure.
- **Route.justified_by** must be a citation already in the file (a matrix verdict, an attribution line). If you can't cite it, you haven't finished Phase 4.
