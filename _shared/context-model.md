# Context model

The single owner of how Wayne stages give an agent the context a task needs. Stages link here; they do not restate it.

## Four layers

Every fact an agent needs sits on one layer. A layer names when the agent reaches the fact and what that costs.

| Layer | What it is | Cost | Holds |
| --- | --- | --- | --- |
| Run | a command and environment that shows the work is right or wrong | build the environment once | how to prove the result: command, environment, observable |
| Reach | the code, data, logs, and services the agent can read | an access grant or a path | where things live and whether the agent can read them |
| Know | written notes reached by a pointer | read when the pointer fires | facts no lookup returns: an unwritten convention, the reason for a choice, a gotcha |
| Lines | instructions loaded into every session | paid on every turn | pointers and the few red lines that must never break |

Build from the bottom of the table up. An agent that cannot run or reach the system guesses, and no amount of Know or Lines fixes that. Put a fact on the cheapest layer that still reaches the agent in time:

- If a lookup returns the fact, do not write it down. A copy goes stale.
- If a check can enforce a rule, make it a check (lint, test, validator), not a sentence.
- Keep each fact in one place.

## Files

Context lives outside the repository, in the project state directory (`pipeline-id-contract.md` § Project state directory):

| File | Scope | Lifetime |
| --- | --- | --- |
| `<state>/context.md` | the project | grows across tasks; `wayne-compress` prunes it |
| `<state>/runs/<topic>/context.md` | one task | starts at `wayne-context-init`; survives `wayne-ship`'s run-directory clear; `wayne-compress` removes it |

Knowledge that a repository reader also needs goes into the module's instruction file the repository already uses (`AGENTS.md` or `CLAUDE.md`), never into `context.md`. `wayne-compress` makes that move.

## Project file shape

The project file uses five sections. Each entry is one line that ends with its source and date.

```markdown
# Context: <project or topic>

## Run
- <command> on <host or environment>; pass = <observable> (source, YYYY-MM-DD)

## Reach
- <what>: <path, URL, or host>; <access: yes | no — why> (source, YYYY-MM-DD)

## Know
- <fact no lookup returns> (source, YYYY-MM-DD)

## Lines
- <red line> (source, YYYY-MM-DD)

## Unknown
- <open gap>: <which layer>; <who or what can close it>
```

## Task file shape

`<state>/runs/<topic>/context.md` is a self-contained brief for one task: why it exists, what it can and cannot reach, what it must deliver, and what it is blocked on. It links the project file and the repository rules instead of copying them. Sections, in order: Header, Background, Reachable resources, Unreachable resources, Requirements, Run, Lines, Questions, Unknown. A section may say `None known`. Soft budget 30–60 lines; review above 80.

```markdown
# Task context: <topic>

## Header
- Topic: <slug>; role: <coordinator | executor | delegated session>; date: YYYY-MM-DD
- Scope: <repo / worktree / host, only when the facts depend on it>
- Links: <project context path>; <plan path, if any>; <E2E contract rows, if any>; <~/.wayne/CONTEXT.md and repository rules, by heading or path>

## Background
- <why this task exists; prior decision or work; current observed state>; status: <observed | documented>; source: <file:line, URL, ticket, or named decision>, <date>

## Reachable resources
- <resource>: <exact path, URL, or host>; access: <command or tool, never a secret value>; from: <host where access was assessed>; status: <observed | documented | unresolved>; source: <reference>, <date>

## Unreachable resources
- <resource>: <known location, or "location unknown">; reason: <why it cannot be reached>; impact: <which work depends on it>; ask: <person, team, or channel>

## Requirements
- Goal: <observable outcome>
- Non-goals: <explicit exclusions>
- Constraints: <approved limits>
- Done when: <observable condition>

## Run
- <command or E2E contract row>; environment/data: <...>; pass: <observable>; status: <documented | observed>; source: <reference>, <date>

## Lines
- <task-specific boundary>; safe alternative: <...>; source: <reference>, <date>

## Questions
- <what is blocked and why>; options: A. <...> B. <...>; recommendation: <X>; status: open | answered (<date>, <answer or where recorded>)

## Unknown
- <gap>; layer: <Run | Reach | Know | Lines | Requirements>; impact: <...>; next safe check: <read-only check>; owner: <person, team, or channel>
```

Retrieval boundary: `~/.wayne/CONTEXT.md` is the global location index, and the repository `AGENTS.md` or `CLAUDE.md` holds shared commands and conventions. Cite them; never copy them. Add only task-specific deltas. Link background unless leaving it out would mislead.

Status vocabulary: `observed` means checked in the named environment at the stated time; `documented` means supported by a named source but not checked here; `unresolved` means missing, inaccessible, stale, or conflicting. A date alone does not prove current access; revalidate volatile access before relying on it, or downgrade it.

A task file holds only what the project file does not already say. A line that is not true yet goes under `## Unknown`, not under its layer. In a task file each layer has its own section: Run goes under `## Run`, Reach under `## Reachable resources` (or `## Unreachable resources` when the agent cannot read it), Know under `## Background`, and Lines under `## Lines`.

## Writing rules

- **Init.** `wayne-context-init` creates the task file as its own stage, before the first stage of the task starts. Its probes are read-only. It never creates `<state>/context.md`; that needs a separate, explicit operation.
- **Mid-task.** An execution agent that finds a gap appends one line to the task file at once: the fact under its layer, or the gap under `## Unknown`. Do not keep it in the conversation only. The execution agents are the `wayne-work` main agent (it writes the gaps its workers report in their result) and delegated sessions; a `wayne-work` worker never writes outside its unit packet. The design and planning stages (`wayne-mind-explode`, `wayne-plan`) only read the task file; their findings live in their own artifacts.
- **Concurrent writers.** Append; do not rewrite another agent's line. If two lines disagree, keep both and mark the older one `(superseded YYYY-MM-DD)`. The next reader reconciles them.
- **Close.** `wayne-compress` moves what lasts out of the task file and deletes the rest.
