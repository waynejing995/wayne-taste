---
name: wayne-goal-prompt
description: "Turns vague or plan-backed intent into a six-section goal for an autonomous run, asks one evidence-closing question when needed, preserves exact verification and real-path proof, gates on user confirmation plus cwd, then dispatches through the bundled headless Codex adapter with fail-loud startup and same-thread resume. Use for goal prompt, sharpen this goal, 写个 goal, 帮我把 goal 补好, or /goal 怎么写."
---

# Wayne Goal Prompt

Produce the smallest self-contained steering goal that lets an autonomous worker loop to observable completion, then dispatch it only after explicit approval.

## Boundary

Own intent grounding, goal composition, confirmation, and the bundled headless dispatch lifecycle. `wayne-plan` owns durable implementation planning and `wayne-work` owns implementation. Never perform the goal's product work here.

Before composition, read the [task prompt contract](../_shared/task-prompt.md). It owns the goal's sections, the plan-SSoT rule, and the secret rule. Read the [Alfred exemplar](references/example-alfred-tui.md) only when real terminal/UI, provider configuration, or secret-forwarding proof needs a contrasting example. For confirmed dispatch, failure, injection, monitoring, or resume, read [dispatch runtime](references/dispatch-runtime.md) completely and use the bundled `scripts/codex-dispatch.sh` and `scripts/codex_goal_driver.py`; do not recreate their protocol manually.

## Goal contract

The goal is a task prompt per the shared contract, with no `Report:` section: the bundled driver monitors the run through its JSONL stream, not a RESULT file. Goal, Context, Tasks, Verification, and Completion criteria carry required information. Current correction appears only for an in-flight correction.

## Flow

```mermaid
flowchart TB
    A["Ground intent and sources"]
    B{"Required evidence complete?"}
    Q["Ask one recommended question"]
    W(["Wait for answer"])
    C["Compose bounded goal"]
    D{"Goal is grounded and testable?"}
    R["Repair one contract gap"]
    E["Present goal and confirm cwd"]
    F{"Goal and cwd confirmed?"}
    S(["Stop without dispatch"])
    G["Dispatch and prove startup"]
    H{"Worker ready?"}
    X(["DISPATCH_FAILED"])
    M["Monitor inject or resume"]
    Z(["Worker owns goal loop"])

    A --> B
    B -->|"no"| Q
    Q --> W
    B -->|"yes"| C
    C --> D
    D -->|"no"| R
    R --> C
    D -->|"yes"| E
    E --> F
    F -->|"no"| S
    F -->|"yes"| G
    G --> H
    H -->|"no"| X
    H -->|"yes"| M
    M --> Z
```

## Process

### A. Ground intent and sources

Preserve the raw intent. Inspect the target repository for real paths, entrypoints, commands, tests, and approved plan/spec/decision artifacts before asking. Separate known evidence from choices only the user owns. Never invent success criteria, scope, secret values, or a fake verification path.

When an approved plan already owns the work, apply the shared plan rule. After drafting, compare Tasks with the plan and delete every term sourced only from a unit body, even in “follow the plan's X”; say `per the plan` instead.

### Q. Ask one recommended question

If a required choice or proof is still missing, ask exactly one Chinese question in this turn. Lead with `我的建议：` when evidence supports a default, explain why, then offer the smallest alternatives for that one decision. Do not batch a second decision, list secondary questions, or invent default criteria; leave later gaps for later turns. Question cardinality is semantic, not a punctuation count. Do not emit a partial goal or advance to dispatch; continue from A after the answer.

### C. Compose the bounded goal

Follow the shared task prompt contract. Inline every boundary at the task it governs. Verification names the unit-level proof the contract's test bar requires, then a smoke check through one real entrypoint, and states the tempting fake substitute that is forbidden. Each Completion criterion maps to a Verification observation. Omit Current correction on a first issue. Keep the goal at most 4,000 characters.

### D. Review the goal

Read the complete grounded sources and goal in context. Confirm that it states one outcome, preserves task-local boundaries, names real verification commands and the actual user entrypoint, protects secrets, and maps every completion claim to observable proof. Then check Verification against the contract's [test bar](../_shared/task-prompt.md#test-bar), behavior by behavior from the change the Tasks make: the hard-bar layers are each named with a runnable command or test, or ruled out with a reason a reviewer could challenge; a bug fix carries its fails-before/passes-after run; the smoke stays light or says why it cannot run; nothing in the goal accepts a substitute the bar forbids. A bare "tests pass", a global coverage percentage, or an end-to-end run standing in for unit tests is a gap. Headings and the template help navigation; order, wording, backticks, phrase bans, regex, and section counts do not decide correctness. Repair one real semantic gap without weakening the evidence contract.

### E. Present and confirm

Return one copy-paste block, then ask in Chinese whether the goal is correct and which exact cwd owns the run. Before both answers are explicit, do not write a goal file, start a process, modify product files, or dispatch.

### G. Dispatch and prove startup

After confirmation, write `goal-<slug>.md` inside the target project and run:

```bash
scripts/codex-dispatch.sh dispatch <goal-file> <cwd>
```

The command prints a job ID only after app-server initialization, thread start, goal setup, and the initial work turn all succeed. If it exits non-zero, report `DISPATCH_FAILED` with the preserved driver log; never claim a worker started. Run `status <job-id>` and require the recorded cwd plus a live or completed state.

### M. Monitor, inject, or resume

Consume the job's JSONL stream with `tail`; do not scrape a TUI or repeatedly call status as a progress loop. Use `inject` for a mid-run review. A paused/blocked goal keeps the same live thread; use `resume <job-id>` only after that state is observed. Usage/budget limits and persistent provider failures remain non-complete and loud.

## Red lines

- Never dispatch an unconfirmed goal or guessed cwd.
- Never replace a named real entrypoint with a helper, mock, or direct internal call.
- Never duplicate an approved plan into the goal prompt.
- Never convert provider failure, blocked, usage-limited, or budget-limited state to success.
- Never kill a live worker to simulate resume or create a second job for the same resume.
