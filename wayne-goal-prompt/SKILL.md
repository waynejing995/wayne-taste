---
name: wayne-goal-prompt
description: |
  Turn a vague one-line intent into a structured, criteria-bearing goal prompt
  — a copy-paste string to feed Codex /goal or hand to another skill. Forces
  success criteria, exact verification commands, and real-path (no-fake-substitute)
  proof BEFORE an agent starts looping, so a terse "finish this" can't burn rounds
  on clarification. Generates the prompt only; never runs it.
  Triggers: "goal prompt", "goal prompt generator", "写个 goal", "帮我把 goal 补好",
  "把这句变成一条 goal", "this goal is too vague / sharpen this goal", "/goal 怎么写".
  Reach for it whenever a goal is about to be handed to an autonomous run.
---

# Wayne Goal-Prompt

> "弱标准逼着 agent 反复问你；强标准让它自己 loop 到验证通过。"

This skill produces a goal prompt **string**. It does NOT write a plan doc
(`wayne-plan`), does NOT build (`wayne-work`), and does NOT run the goal
(Codex `/goal` is the runner). Generate only — emit the prompt, then STOP.

## Inherits from ~/.claude/CLAUDE.md

Inherits the Wayne control-plane invariants; does NOT redeclare them
(Language / Engineering Principles / Code Standards / Behavior / proportional
effort). This skill only specifies the goal-prompt composition workflow.

## Boundary vs neighbors

A goal prompt is the *steering string* you feed a runner. It sits ABOVE plan:
a goal may name `/wayne-plan -> /wayne-work` as its own skill-chain slot.

| Skill | Input | Output |
|---|---|---|
| **wayne-goal-prompt** | a vague intent | a 6-section goal prompt **string** (ephemeral, paste-ready) |
| wayne-plan | a spec / requirements | a durable, dependency-ordered plan **doc** in `docs/plans/` |
| wayne-work | a plan | code + tests (executes) |
| Codex `/goal` (native) | a goal prompt | a run (the runner — consumes, does not author) |

## The anatomy — 6 sections (the SSoT)

Mined from a golden exemplar. Sections 1/2/4/5/6 required; 3 by-need.

| § | Section | Req | What goes in | Red-line |
|---|---|---|---|---|
| 1 | **Goal** | ✅ | one-line outcome | a sentence, an outcome — NOT a task list |
| 2 | **Context** | ✅ | framing facts, definitions, what-this-is-NOT | each constraint phrased as a `Do not X` red-line |
| 3 | **Current correction** | ◻ | the delta steering an in-flight attempt; concrete config / paths / values | include ONLY when correcting; omit on first issue |
| 4 | **Tasks** | ✅ | numbered steps; constraints inlined AT the step they govern | no constraint dump; secrets via env-var name, never plaintext |
| 5 | **Verification required** | ✅ | exact commands + a real e2e path | name the command; FORBID fake substitutes |
| 6 | **Completion criteria** | ✅ | testable, bulleted done-definition | each bullet checkable — never "works well / looks good" |

The two failure modes the evidence shows: §5 hand-waved ("run the tests") and
§6 unfalsifiable ("works"). Every §6 bullet MUST map to a §5 command.

Template + the golden exemplar live in `references/` — read before composing.

## When a plan doc already exists — reference, don't restate

If the work is already captured in a plan / spec / decision doc, that doc is the
SSoT. The goal prompt **points at it and carries only the steering layer** — it
must NOT re-paste the plan's step bodies, tables, or rationale. Duplication rots
(two sources drift) and bloats the prompt.

- §1/§2: name the doc path as the SSoT ("follow its §N exactly"); state only the
  framing + red-lines a runner needs to not go off-rails.
- §4 Tasks: one line per plan unit (the verb + where it lands), NOT the plan's
  full sub-steps. The runner opens the doc for detail.
- §5/§6: these stay concrete and self-contained — verification commands and
  done-criteria are the steering contract, not plan detail, so they live in the
  prompt in full.

Rule of thumb: if a line is reconstructable by reading the named doc, cut it.
Keep what the runner needs to *steer and verify*, drop what it can *look up*.
A prompt that duplicates the plan is too long by definition.

## When to Run

- **Manual:** `/wayne-goal-prompt <raw intent>`.
- **Auto-trigger:** the bilingual phrases in the description.

**Skip when:** the goal is already 6-section-complete, or the task is trivial
enough that a one-liner genuinely suffices (proportional effort).

## Flow

```dot
digraph goalprompt {
    rankdir=TB;

    "Capture raw intent" [shape=box];
    "Gap-scan the 6 sections" [shape=box];
    "All required sections fillable?" [shape=diamond];
    "Ask MIN clarifying Qs (Chinese)\nnever invent criteria" [shape=box, style=bold];
    "Compose 6-section prompt\n(constraints inlined, real verify)" [shape=box];
    "Every §6 criterion maps\nto a §5 command?" [shape=diamond];
    "Emit copy-paste block. STOP.\n(do not run, do not write files)" [shape=doublecircle];

    "Capture raw intent" -> "Gap-scan the 6 sections";
    "Gap-scan the 6 sections" -> "All required sections fillable?";
    "All required sections fillable?" -> "Ask MIN clarifying Qs (Chinese)\nnever invent criteria" [label="no"];
    "All required sections fillable?" -> "Compose 6-section prompt\n(constraints inlined, real verify)" [label="yes"];
    "Ask MIN clarifying Qs (Chinese)\nnever invent criteria" -> "Compose 6-section prompt\n(constraints inlined, real verify)";
    "Compose 6-section prompt\n(constraints inlined, real verify)" -> "Every §6 criterion maps\nto a §5 command?";
    "Every §6 criterion maps\nto a §5 command?" -> "Compose 6-section prompt\n(constraints inlined, real verify)" [label="no"];
    "Every §6 criterion maps\nto a §5 command?" -> "Emit copy-paste block. STOP.\n(do not run, do not write files)" [label="yes"];
}
```

## Process Flow

1. **Capture intent** — take the raw ask verbatim. → verify: restate it as a
   one-line §1 Goal (outcome, not steps).
2. **Gap-scan** — check each of the 6 sections against what's given; the
   failure-prone three are §5 (exact cmds), §6 (testable), §2 (red-lines).
   → verify: list which required sections you cannot fill.
3. **Ask the minimum** — for each unfillable required section, ask ONE pointed
   question in Chinese. Never silently invent success criteria. → verify: no
   required section left guessed.
4. **Compose** — fill the 6 sections; inline each constraint at the task it
   governs; §5 names real commands + a real e2e path; §6 bullets are testable.
   → verify: every §6 criterion maps to a §5 command.
5. **Emit + STOP** — output one copy-paste block. Do not execute, do not write
   files. → verify: nothing ran; output is a prompt.

## Anti-patterns

- **Vague Goal** — `finish this` / `ok continue`; §1 must be an outcome.
- **Hand-waved verify** — "run the tests" instead of the exact command line.
- **Unfalsifiable done** — §6 like "works well / 更好看"; make it checkable.
- **Constraint dump** — red-lines pooled away from the task they govern.
- **Fake substitute** — letting verify swap the real path for a stand-in
  (e.g. "call the CLI instead of driving the TUI") — kills the proof.
- **Running it** — executing the goal instead of emitting it (runner's job).
- **Plaintext secrets** — copying secret values in; pass an env-var name.
- **Plan-restate** — re-pasting a plan doc's steps/tables/rationale into the
  prompt when the doc is the SSoT. Reference it ("follow §N of <path>"); carry
  only the steering layer + self-contained §5/§6. If it's reconstructable from
  the doc, cut it.

> Distilled from 15 sessions on 2026-06-17 by wayne-distill, forged by
> wayne-skill-forge. Anatomy anchored on the Alfred-TUI golden exemplar.
