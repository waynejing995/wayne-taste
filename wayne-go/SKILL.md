---
name: wayne-go
description: "Wayne's front door: reads a raw request, picks the one Wayne route that fits (quick task prompt, design, plan, triage, build, review, ship, resume, delegate, structure sweep), and returns the prompt for that next step. It writes prompts only; it never runs, invokes, or dispatches anything. Use for /wayne-go, 直接干, 帮我起个头, 这个该走哪个流程, which skill fits, or quick task prompt."
---

# Wayne Go

Select one route from observable evidence, write the prompt for that route, and stop. This skill never does product work and never starts a skill, session, or dispatch: the user decides who runs the prompt and where.

## Routes

| Observable signal | Route | Prompt it returns |
| --- | --- | --- |
| Small or low-stakes work with a clear target: one repository, no open design question, and nothing in the table's next note | [quick lane](references/quick-lane.md) | a complete task prompt any agent can run |
| New medium or large task (feature, redesign, multi-file change) where Wayne wants autonomous design + build without an interview loop | `wayne-auto-design-task` | next-step prompt (dual proposals w/ Gemini 4 Neon → `design.md` → `wayne-test-design` → `wayne-plan` → `wayne-work`) |
| The idea, scope, or behavior is unsettled AND Wayne explicitly asks to brainstorm / be grilled, or the change reverses a living spec in `docs/specs/` | `wayne-mind-explode` | next-step prompt |
| The behavior is settled (a focused multi-file change, or an urgent hotfix whose root cause is already confirmed — never dual-proposal design for hotfixes) | `wayne-plan` | next-step prompt (Plan takes its lite path when no decision log exists) |
| An approved plan exists for this topic | `wayne-work` | next-step prompt naming the plan path (parallel `isolated: true` units, one commit per unit) |
| Something is failing: an error, a log, a red test, an incident, an issue | `wayne-triage` | next-step prompt carrying the symptom |
| Existing PR review comments need verification before fixing | `wayne-fix-review` | next-step prompt naming the PR |
| A diff is ready for review | `wayne-code-review` | next-step prompt naming the range (≥1% evidence-backed CRITICAL gate) |
| Review passed and the user wants to commit, push, or open a PR | `wayne-ship` | next-step prompt |
| A job finished (`status: done`) and needs retro candidates | `wayne-compress` | next-step prompt (top 3 candidates only, apply nothing) |
| The user wants to resume earlier work | `wayne-checkpoint` | next-step prompt (resume) |
| The user wants to understand an unfamiliar repository | `wayne-codebase-report` | next-step prompt |
| The user wants a periodic whole-repository structure check, or asks what to refactor, with no single change in mind | `wayne-arch-sweep` | next-step prompt (scans + ranked candidates; a picked candidate returns a `wayne-auto-design-task` prompt, or `wayne-mind-explode` on a spec reversal) |
| The user wants a long autonomous run on Codex | `wayne-goal-prompt` | next-step prompt |
| The user wants work delegated into its own isolated `ovnfs` checkout + tern/herdr/tmux session under inbox watch, or wants a finished session torn down and closed | `wayne-inbox` [references/delegate.md](../wayne-inbox/references/delegate.md) | next-step prompt |
| none match | — | one question |

The quick lane and the pipeline routes are exclusive. Do not take the quick lane if the change touches a shared interface, a schema, or a migration, or if it alters what code that deletes data, deploys, publishes, or migrates will do. File count does not decide this: a one-line change to a deletion script is irreversible once it runs, and a quick prompt carries no plan to catch that.

## Flow

```mermaid
flowchart TB
    A["Collect routing evidence"]
    B{"Which signal matches?"}
    Q["Write quick-lane task prompt"]
    P["Write next-step prompt"]
    N["Ask one question"]
    W(["Wait for answer"])
    D(["Return prompt; stop"])

    A --> B
    B -->|"quick lane"| Q
    B -->|"pipeline route"| P
    B -->|"none or two fit"| N
    N --> W
    W --> A
    Q --> D
    P --> D
```

## Process

### A. Collect routing evidence

Read the raw request. If a repository is in scope, inspect it only enough to answer the table's predicates: the files the request names, whether other modules import them, whether a plan or decision log exists for the topic under `<state>/` (resolve `<state>` with `_shared/scripts/wayne-state-dir.sh`), and whether a test or run command exists. Every routing claim must trace to something you read, because a guess about size is how a shared change lands in the quick lane.

Read only. Do not edit, run the change, or diagnose past what the predicates need: the selected route owns that work.

### N. Ask one question

If no row fits, or two rows fit and the evidence cannot separate them, ask exactly one Chinese question. Lead with `我的建议：` and name one route. If the evidence favors no route, name the route the request's wording suggests most, so the user can answer with one word. Return only that question: put no findings report before it, because the user has to answer it before any finding matters. Do not write a prompt before the answer.

### Q. Write quick-lane task prompt

Read [quick lane](references/quick-lane.md) completely, then follow it.

### P. Write next-step prompt

Write one copy-paste block the user can send to start the selected skill:

```text
/<skill> <the raw request, verbatim>

Evidence from routing:
- <fact and its source path or command output>
```

Carry pointers (paths, SHAs, plan paths, error lines), not copies of files. Do not add tasks, acceptance criteria, or a design: the selected skill owns them, and a pre-filled version competes with what that skill derives.

### D. Return prompt and stop

Before the block, write one Chinese line naming the route and the fact that selected it. Return the block and stop. Do not invoke the skill, open a session, or dispatch the prompt, because the user has not chosen who runs it or where.
