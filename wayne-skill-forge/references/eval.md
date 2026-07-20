# Skill evaluation protocol

Use this protocol for a new skill or a meaningful revision. The purpose is to
measure whether the skill changes behavior correctly, not whether reviewers like
the prose.

## Contents

1. Define the baseline
2. Run the forge meta-eval when evaluating a skill generator
3. Build the case set
4. Run isolated trials
5. Score outputs
6. Decide and iterate
7. Trigger evaluation

## 1. Define the baseline

| Change | Control | Candidate |
|---|---|---|
| new skill | strongest model without the skill | strongest model with candidate |
| revise skill | current skill snapshot | candidate skill |
| slim skill | current full skill | smaller candidate |
| description only | current metadata | candidate metadata |

Keep model, reasoning effort, available tools, permissions, task text, and input
artifacts identical. Record the skill files and model setting used in each trial.

### Repository harness ownership

Before changing an existing skill, create or reuse `eval/<skill-name>/` in the
same repository. That directory owns approved intent, task text, exact fixtures,
frozen checkers, checker calibration, and downstream hidden tests. Keep generated
workspaces, provider state, traces, candidates, and identity maps under the
gitignored `eval/.runs/<skill-name>/`.

Lock one run to one target skill. Record control and candidate tree hashes before
generation; do not let a run silently edit sibling skills or replace its evaluator.
The harness must run from the repository path without depending on a previous
`/tmp` workspace.

## 2. Forge meta-eval

Do not evaluate a skill generator only by reviewing the skill files it writes.
That measures authoring style, not execution effect.

Use a two-stage paired trial:

```text
old forge       → child skill A → fresh downstream agent → task result A
candidate forge → child skill B → fresh downstream agent → task result B
```

### Stage 1: generate paired child skills

- Give old and candidate forge the same approved intent, evidence, constraints,
  model, effort, tools, and return-only instruction.
- Run each in a fresh context.
- Do not manually repair either generated skill.
- Store child skills under neutral IDs so downstream agents and judges do not know
  which forge produced them.
- Repeat across procedure, lens, and router when the forge claims all three.
- Run every bundled script. For validators, record a passing positive fixture,
  one failing mutation per invariant family with expected findings, and lint/static
  results. Manual inspection does not count as execution.

### Stage 2: execute through the child skills

- Give each child skill to a fresh downstream agent.
- Run identical real task cases with identical artifacts and permissions.
- Capture user-visible outcome, tool trace, verification evidence, boundary
  behavior, failures, tokens, latency, clarification count, and terminal reason
  when available.
- Use deterministic structural checks and a blind AI semantic judge when both
  layers apply. The judge sees task, result, sources, and evidence, not forge
  identity or expected winner.
- When the child creates a machine-checkable artifact, run its frozen deterministic
  checker before the blind judge. Keep invalid output unchanged as evidence.
- Freeze that checker from the approved intent before candidate generation. Never
  use only the child-authored validator as the oracle; it may encode the same drift
  as the child schema and template.
- Trace every deterministic finding to an explicit clause in the published intent
  or task. A hidden evaluator expectation is an evaluator defect, not a candidate
  failure.
- Pass original source artifacts to checks for verbatim carry, completeness, and
  real repository surfaces. A checker that reads only the generated artifact cannot
  score those dimensions.
- Separate proof owners. Deterministic gates cover directly observable low-freedom
  grammar, hashes, exact literals and snapshots, ID/state closure, file mutation,
  and recorded event order. Independent AI review covers intent, semantic
  classification, completeness, equivalence, and causality by reading the complete
  sources. Both must pass when both layers apply.
- Never let headings, ID prefixes, keywords, substring scans, counts, regex, or
  string similarity decide prose meaning. A paraphrase that preserves meaning must
  pass the AI gate; same-shaped text with weaker meaning must fail it. Do not keep a
  lexical semantic proxy merely because AI review was added. Keep only a separate,
  directly observable structural invariant; otherwise remove that check from the
  gate or expose a real structured field.
- For plan/spec/router artifacts whose value is downstream transfer, give a fresh
  executor only the produced artifact and runnable repository, not the upstream
  sources it could use to redo the work. Inject hidden acceptance tests only after
  that executor exits.

The candidate forge passes only when its generated skills match or improve real
task execution without hard-boundary regression. Smaller child skills, prettier
Flowcharts, and cleaner structure are secondary tie-breakers.

Use paired win/tie/loss plus invalid trials rather than averaging unrelated tasks:

| Outcome | Meaning |
|---|---|
| win | candidate succeeds where control fails, or equal correctness with lower cost |
| tie | both meet the complete task and boundary contract |
| loss | candidate fails, violates a boundary, or loses required evidence |
| invalid | infrastructure or tool termination prevents a behavioral observation |

With a small case set, treat any hard-boundary loss as blocking. Do not claim
statistical superiority; report invalid cells separately from observed cases and
state the residual uncertainty.

## 3. Build the case set

Use real prompts and raw artifacts from usage history when available. Do not tell
the test agent what failure is expected or what the candidate changed.

For every observed failure proposed as an anti-pattern, build one exact case with:

- the raw task and minimum source artifact needed to reproduce it;
- a causally verified failure mechanism, not a log-only guess;
- the same environment, permissions, tools, and initial state for both sides;
- a frozen observable oracle, preferably deterministic;
- a neighboring regression case and a held-out transfer case.

First run the control. If it does not reproduce the failure, the case cannot
justify a skill edit. If the failure is provider noise, a tool boundary, or an
agent execution lapse that the skill cannot change, classify it separately and do
not add an anti-pattern. A failure-driven candidate is eligible only when the
target case flips from fail to pass and all control-pass cases remain passing.
For pure slimming without a target failure, require behavioral parity and use
smaller context only as the tie-breaker.

Default minimum:

- one common case;
- one boundary or ambiguous case;
- one failure, missing-input, or no-match case.

Use at least five cases when false triggering, destructive actions, security,
state mutation, or expensive operations are involved.

For an archetype-specific eval, include:

| Archetype | Required case |
|---|---|
| procedure | a failed verification that must loop back |
| lens | a case where the lens applies and one where it must decline |
| router | every playbook signal plus the no-match path |

## 4. Run isolated trials

Run control and candidate in fresh contexts. A forward-test prompt should look like
a real request:

```text
Use the skill at <path> to perform <task>. Return the requested artifact only.
Do not modify live systems or publish anything.
```

Do not say “review this skill”, reveal the desired answer, list suspected bugs, or
share the other trial's output. Capture the final artifact, tool trace, errors,
token/context usage when available, and any requested confirmation.

Filesystem isolation is part of validity. A test agent must not be able to read the
other candidate, evaluator implementation, hidden tests, prior trial output, or the
intended winner. Prompt-only secrecy is a limitation, not strong isolation.

If a run ends at a provider error, timeout, or tool-use boundary before producing
the requested observable result, mark the cell `invalid`; do not turn it into a
behavioral loss. Preserve the trace and rerun that cell under the same conditions.
Do not repair or score a partial artifact from an invalid run.

For changes that could touch production or take substantial time, request approval
before launching the trial. Prefer read-only or return-only tasks for routine evals.

## 5. Score outputs

Score each dimension `0`, `1`, or `2`:

| Dimension | 0 | 1 | 2 |
|---|---|---|---|
| Task success | failed | partial | complete |
| Hard boundaries | violated | ambiguous | fully respected |
| Output contract | wrong/missing | repairable | exact |
| Control flow | skipped or wrong | mostly followed | branches/loops/gates correct |
| Resource use | missed/overloaded | usable | loads only needed resources |
| Context efficiency | materially worse | similar | smaller with equal behavior |

Hard boundaries and task success are gates, not averages. A candidate fails if it
scores `0` on either, even when its total score is higher.

## 6. Decide and iterate

Accept when:

- candidate has no task-success or hard-boundary regression;
- required output and control flow are at least as reliable as control;
- no new false route, silent fallback, or unnecessary approval appears;
- the smaller candidate wins when behavior is equal.

When candidate fails, connect the failure to one smallest correction:

- missing local fact → add that fact once;
- wrong route → sharpen one observable predicate;
- skipped gate → add one explicit gate plus reason;
- wrong shape → add or repair a template;
- repeated fragile work → add a validator or script.

Re-run the failed case and one neighboring case. Do not add a general essay in
response to one miss.
Retain a rejected edit with its case IDs and score drop in the run record so a
later iteration does not propose the same harmful change again.

## 7. Trigger evaluation

Trigger evaluation is separate from body evaluation because only metadata is
available before activation.

Build two prompt sets:

- positives: direct triggers plus non-obvious paraphrases that should load it;
- negatives: neighboring-skill prompts and generic prompts that should not load it.

Measure:

| Metric | Meaning |
|---|---|
| recall | expected activations that occurred |
| precision | actual activations that were correct |
| false-neighbor rate | prompts routed to this skill instead of its closest sibling |

Do not optimize recall by making the description claim an entire domain. Front-load
the unique job, include real trigger phrases, and state the closest boundary.

## Eval report

```markdown
## Eval: <skill> — <control> vs <candidate>

| Case | Control | Candidate | Boundary | Flow | Notes |
|---|---:|---:|---:|---:|---|
| common |  |  |  |  |  |
| boundary |  |  |  |  |  |
| failure/no-match |  |  |  |  |  |

- Static validation: pass/fail
- Description: <chars before → after>
- SKILL.md: <lines/words before → after>
- Verdict: accept/revise/reject
- Residual uncertainty: <untested area>
```
