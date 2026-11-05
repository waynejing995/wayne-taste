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

Knowledge that a repository reader also needs goes into the repository's nearest module `CLAUDE.md`, never into `context.md`. `wayne-compress` makes that move.

## Shape

Both files use the same five sections. Each entry is one line that ends with its source and date.

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

A task file holds only what the project file does not already say. A line that is not true yet goes under `## Unknown`, not under its layer.

## Writing rules

- **Init.** `wayne-context-init` creates the task file as its own stage, before the first stage of the task starts. Its probes are read-only.
- **Mid-task.** An execution agent that finds a gap appends one line to the task file at once: the fact under its layer, or the gap under `## Unknown`. Do not keep it in the conversation only. The execution agents are the `wayne-work` main agent (it writes the gaps its workers report in their result) and delegated sessions; a `wayne-work` worker never writes outside its unit packet. The design and planning stages (`wayne-mind-explode`, `wayne-plan`) only read the task file; their findings live in their own artifacts.
- **Concurrent writers.** Append; do not rewrite another agent's line. If two lines disagree, keep both and mark the older one `(superseded YYYY-MM-DD)`. The next reader reconciles them.
- **Close.** `wayne-compress` moves what lasts out of the task file and deletes the rest.
