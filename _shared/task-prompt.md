# Task prompt

The single owner of the prompt a Wayne skill writes for another agent to execute: a goal for an autonomous run (`wayne-goal-prompt`), a brief for a delegated session (`wayne-inbox`, [references/delegate.md](../wayne-inbox/references/delegate.md)), or a quick-lane prompt (`wayne-go`). Callers link here and add only their own delivery step. They do not restate these sections.

The executor starts blank. Every fact in the prompt is fetched with a tool while you write it, never recalled. Pass pointers (paths, SHAs, URLs, ticket keys), not copies. The prompt is at most 4,000 characters: measure it (`wc -c`) before you return it. If it is too long, cut reconstructible narrative from Context and Tasks first, then merge Verification lines, but keep every test-bar layer.

## Sections

| Section | Required | Contract |
| --- | --- | --- |
| `Pain:` | yes | First section. Observable symptom today: what the user tried, what they saw, why it hurts, a short verbatim quote (who/where/when), and any screenshot path. No solution words. |
| `Goal:` | yes | One outcome sentence that resolves the Pain, not a task list. |
| `Skill:` | yes | Exact owning Wayne skill(s) right below `Goal:` (e.g. `Follow wayne-auto-design-task`, `Follow wayne-plan (lite) + wayne-work`, `Follow wayne-fix-review`, `Follow wayne-triage`). Instruct the executor to read `skill://<name>` first. Never omit for coding, fix, design, or review work; only trivial read-only checks may write `none (read-only)`. |
| `Context:` | yes | Framing, definitions, the skill the executor follows, the task context file, the relevant glossary lines from `~/.wayne/CONTEXT.md`, and every `Do not` boundary that is not owned by one task. A remote executor cannot read that file, so the brief carries the lines. |
| `Current correction:` | only when steering an in-flight attempt | The delta from the actual prior attempt: what changed and what was wrong. |
| `Inputs:` | when the job has concrete starting state | Branch and head SHA, PR, artifact ID and version, ticket keys, paths. Verify each one before you write it. |
| `Tasks:` | yes | Numbered work. Write each constraint and each `Do not` at the step it governs. |
| `Verification required before completion:` | yes | The unit-level proof the [test bar](#test-bar) requires, then a light smoke check through the real user entrypoint. Exact commands. Name the tempting fake substitute and forbid it. |
| `Completion criteria:` | yes | Independently checkable outcomes (each maps to a Verification line), plus "the Pain is gone, as observed through the real UI or entrypoint". |
| `Report:` | when the executor runs in a separate session | The deliverable path and the RESULT block below. |

- **Context.** If a Wayne skill owns the work, write `Follow <skill>.` If the repository has rule files (`AGENTS.md`, `CLAUDE.md`, `.claude/rules/`), write `Repository rules in <those paths> win over this prompt.` and name only the paths that exist. If `<state>/runs/<topic>/context.md` exists, point to it and tell the executor to append a line there the moment it finds a gap. Copy the glossary lines from `~/.wayne/CONTEXT.md` that name a product, repository, stage, host, or person this task uses. State each hard limit as a `Do not` line, for example: no merge, no deploy, no force-push, read-only production database, no Teams or Jira posts.
- **Approved plan.** If an approved plan owns the work, name its path as the SSoT. In Tasks, carry only `<unit ID> — <unit heading or outcome> — implement per <plan path>`. Do not copy step bodies, tables, rationale, or implementation detail from the plan. Keep Verification and Completion criteria self-contained.
- **Isolated checkouts (`ovnfs`).** Always run `ovnfs new --rev` from the source repository directory (never from inside another checkout), pass the checkout's absolute path in every worker brief so relative edits cannot land in the source repo, and verify the source repository's `git status` is still clean before reporting completion.
- **Secrets.** Never write a secret value. Name the environment variable that owns the secret.
- **Missing evidence.** If the target, the success criterion, or the verification path is unknown and the repository does not answer it, do not invent one. The calling skill asks the user one question and writes the prompt after the answer.
- **Coding/testing worker model policy (mandatory in every brief).** Every brief and task requirement MUST state: coding and testing subagents use only the `task` role model (or `small-model`). Never self-promote a coding/testing worker to Opus or `highend-nonopus`; if stuck or hitting a model failure, stop and ask the coordinator for help instead.
- **Mid-session feedback.** Every brief for a separate session carries this line: "When Wayne gives you feedback during the session, the main model writes a lite plan: split the change into independent slices, and for each slice give its files and its acceptance in one or two lines. No design document, and no plan review: skip any review gate on the lite plan. Then it hands each slice to its own `task`-model subagent, all in parallel, and they do the work directly. The main model does not do the edit itself, and it does not reopen discussion before the subagents start."

### UI flow

For any task that changes user-facing UI, interaction, or copy, `Tasks:` must require these steps in order, and the executor must return the comparison table and review resolutions (in `RESULT.md` under `Report:` when running in a separate session):

1. **Two proposals in parallel.** The main model writes its design while a Gemini subagent independently writes one from the same `Pain`, `Goal`, and `Inputs` without seeing the main model's design.
2. **Fuse.** The main model compares both in a table (point, A, B, choice, why) and merges them into one design.
3. **Gemini review.** A Gemini subagent reviews the merged design's interaction and copy (flow, states, feedback, wording, and what the user sees at each step); the main model adopts each point or rejects it with a reason.
4. **Implement.** Only after step 3 does implementation start, through the executor's normal build path (for example `wayne-work` units).

Gemini subagent: use Gemini 4 Neon (`gemini-4-neon`), not Carbon or another Gemini, and pass its exact selector as the `task` call's `model`, never a role name. Each host's selector is listed in `~/.wayne/CONTEXT.md`. A role can carry a `retry.fallbackChains` entry that falls back to Opus, so a role is not enough. If the Gemini call fails, report it and ask; do not rerun it on another model. Never use Opus unless Wayne authorizes it.

## Test bar

"Tests pass" is not proof, and the bar is proportional: each required test names the bug it catches, one that happened (git log, an incident, a review finding) or that real inputs will plausibly hit. A scenario that is only theoretically possible gets no test. In Verification, write one line per layer: `<layer>: <command or test id> — catches <bug>`, or `<layer>: none — <reason>`. `wayne-test-design` owns full test-matrix design.

Hard bar, a completion gate:

- **Unit.** Tests on fabricated data (fixtures, fakes, mocked I/O) that assert the unit's own output for the inputs real data produces: normal, empty, boundary, and the error paths seen before. Not every exotic combination. An error-path test asserts only that the error surfaces with its cause (exception type or exit status, cause in the message or log, nothing swallowed); it does not ask for retry or recovery logic.
- **Changed-branch coverage.** Measured on the diff, never a global percentage: `pytest --cov --cov-branch --cov-report=xml` then `diff-cover coverage.xml --compare-branch=<base> --branch-coverage`. Each uncovered changed branch is tested or listed in RESULT with why it is not worth a test.
- **Bug fix.** A regression test that fails on the base commit and passes after the fix; Verification shows both runs.
- **Property / Differential.** Whenever the diff touches a state machine, parser, round-trip transform (migration/rollback, encode/decode), concurrency monotonicity, or a rewrite/migration with an existing oracle, emit a `Hypothesis` (Python) or `fast-check` (TS) property test or a differential test against the old path — or write `Property: none — <reason>` naming why no law applies. Name the invariant and tool. Not a quota for plain CRUD/UI glue.
- **Forbidden.** A mock replaces an input or a dependency, never the unit under test. No test that asserts its own mock's return or only that a mock was called, asserts source text, runs code with no assertion to raise coverage, or skips, xfails, deletes, or loosens a failing test.

Smoke, light: one run of the changed path through the real entrypoint, read-only or offline where one exists, showing the feature roughly works; or `Smoke: none — <why it is unreachable>`. It is not a completion gate on live traffic: do not wait for a natural event, a live post, or a full lifecycle, and do not ask for an end-to-end suite unless the task is about one.

A missing tool runs without adding a dependency (`uv run --with diff-cover …`, `npx`).

## Report block

For a separate session, the deliverable is `<state>/runs/<topic>/RESULT.md`, outside the repository. Resolve `<state>` with `_shared/scripts/wayne-state-dir.sh` on the host where the session runs. The executor writes its report there in 简体中文, repeats the report as its final message, and ends both with:

```text
RESULT
status: done | partial | blocked
commits: <shas, or none>
artifact: <url vN, or none>
verified: <what you ran and saw>
open: <questions for Wayne, or none>
```

`wayne-inbox` reads the `status:` line. Do not rename these fields.

## Skeleton

```text
Pain:
- <what the user tried, what they saw, why it hurts; no solution words>
- Quote: "<verbatim words>" (<who>, <where>, <when>)
- Screenshot: <path, or omit if none>

Goal: <one outcome sentence resolving the Pain>

Skill: Follow <exact wayne skill(s)> — read `skill://<name>` first before acting.

Context:
- <framing fact: what this is, which structure to keep>
- <definition: what "done" or "correct" means here>
- Follow <wayne skill>. Repository rules in <AGENTS.md / CLAUDE.md / .claude/rules/, only those that exist> win over this prompt.
- Task context: <state>/runs/<topic>/context.md. Append a line there when you find a gap.
- Do not <hard limit>.
- Coding/testing worker model rule: use only the `task` role model (or `small-model`) for coding and testing subagents; never self-promote to Opus or `highend-nonopus` — ask the coordinator for help instead.
- Do not claim completion until <the real proof> has happened.

Current correction:            <- only when steering an in-flight attempt
- <delta from the last attempt>

Inputs:
- <branch @ sha, PR, artifact id vN, ticket key, path>

Tasks:
1. <concrete step>
   - <constraint or "Do not" for this step>
2. <concrete step>

Verification required before completion:
- Unit: <test id> — catches <bug>.                   <- one line per layer,
- Branch coverage: <diff-cover command>.             <- or `<layer>: none — <reason>`
- Regression: <test id> fails on <base>, passes after.   <- bug fix only
- Smoke: <real entrypoint run and what it shows>. Do not replace it with <fake substitute>.

Completion criteria:
- The Pain is gone, as observed through the real UI or entrypoint -> <Verification line>.
- <checkable outcome -> which verification line (layer) shows it>
- <negative criterion: no secret printed, no fake substitute used>

Report:                        <- only for a separate session
- Write <absolute path>/RESULT.md, then repeat it as your final message. End both with the RESULT block.
```
