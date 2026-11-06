# Task prompt

The single owner of the prompt a Wayne skill writes for another agent to execute: a goal for an autonomous run (`wayne-goal-prompt`), a brief for a delegated session (`delegate-agent-session`), or a quick-lane prompt (`wayne-go`). Callers link here and add only their own delivery step. They do not restate these sections.

The executor starts blank. Every fact in the prompt is fetched with a tool while you write it, never recalled. Pass pointers (paths, SHAs, URLs, ticket keys), not copies. The prompt is at most 4,000 characters: measure it (`wc -c`) before you return it. If it is too long, cut reconstructible narrative from Context and Tasks first, then merge Verification lines, but keep every test-bar layer.

## Sections

| Section | Required | Contract |
| --- | --- | --- |
| `Goal:` | yes | One outcome sentence, not a task list. |
| `Context:` | yes | Framing, definitions, the skill the executor follows, the task context file, and every `Do not` boundary that is not owned by one task. |
| `Current correction:` | only when steering an in-flight attempt | The delta from the actual prior attempt: what changed and what was wrong. |
| `Inputs:` | when the job has concrete starting state | Branch and head SHA, PR, artifact ID and version, ticket keys, paths. Verify each one before you write it. |
| `Tasks:` | yes | Numbered work. Write each constraint and each `Do not` at the step it governs. |
| `Verification required before completion:` | yes | The unit-level proof the [test bar](#test-bar) requires, then a light smoke check through the real user entrypoint. Exact commands. Name the tempting fake substitute and forbid it. |
| `Completion criteria:` | yes | Independently checkable outcomes. Each one maps to a Verification line. |
| `Report:` | when the executor runs in a separate session | The deliverable path and the RESULT block below. |

- **Context.** If a Wayne skill owns the work, write `Follow <skill>.` If the repository has rule files (`AGENTS.md`, `CLAUDE.md`, `.claude/rules/`), write `Repository rules in <those paths> win over this prompt.` and name only the paths that exist. If `<state>/runs/<topic>/context.md` exists, point to it and tell the executor to append a line there the moment it finds a gap. State each hard limit as a `Do not` line, for example: no merge, no deploy, no force-push, read-only production database, no Teams or Jira posts.
- **Approved plan.** If an approved plan owns the work, name its path as the SSoT. In Tasks, carry only `<unit ID> — <unit heading or outcome> — implement per <plan path>`. Do not copy step bodies, tables, rationale, or implementation detail from the plan. Keep Verification and Completion criteria self-contained.
- **Secrets.** Never write a secret value. Name the environment variable that owns the secret.
- **Missing evidence.** If the target, the success criterion, or the verification path is unknown and the repository does not answer it, do not invent one. The calling skill asks the user one question and writes the prompt after the answer.

## Test bar

"Tests pass" is not proof, and the bar is proportional: each required test names the bug it catches, one that happened (git log, an incident, a review finding) or that real inputs will plausibly hit. A scenario that is only theoretically possible gets no test. In Verification, write one line per layer: `<layer>: <command or test id> — catches <bug>`, or `<layer>: none — <reason>`. `wayne-test-design` owns full test-matrix design.

Hard bar, a completion gate:

- **Unit.** Tests on fabricated data (fixtures, fakes, mocked I/O) that assert the unit's own output for the inputs real data produces: normal, empty, boundary, and the error paths seen before. Not every exotic combination. An error-path test asserts only that the error surfaces with its cause (exception type or exit status, cause in the message or log, nothing swallowed); it does not ask for retry or recovery logic.
- **Changed-branch coverage.** Measured on the diff, never a global percentage: `pytest --cov --cov-branch --cov-report=xml` then `diff-cover coverage.xml --compare-branch=<base> --branch-coverage`. Each uncovered changed branch is tested or listed in RESULT with why it is not worth a test.
- **Bug fix.** A regression test that fails on the base commit and passes after the fix; Verification shows both runs.
- **Property**, only when the invariant is one line (round-trip, idempotence, a bound) and the code has bitten us or is clearly bug-prone, such as a parser or boundary arithmetic. Name the relation and the tool (Hypothesis, fast-check). Not by default.
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
Goal: <one outcome sentence>

Context:
- <framing fact: what this is, which structure to keep>
- <definition: what "done" or "correct" means here>
- Follow <wayne skill>. Repository rules in <AGENTS.md / CLAUDE.md / .claude/rules/, only those that exist> win over this prompt.
- Task context: <state>/runs/<topic>/context.md. Append a line there when you find a gap.
- Do not <hard limit>.
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
- <checkable outcome -> which verification line (layer) shows it>
- <negative criterion: no secret printed, no fake substitute used>

Report:                        <- only for a separate session
- Write <absolute path>/RESULT.md, then repeat it as your final message. End both with the RESULT block.
```
