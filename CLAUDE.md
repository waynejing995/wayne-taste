# Wayne Control Plane — Global Invariants

This file is the **single source of truth** for Wayne control-plane invariants.
All `wayne-*` skills inherit from here and MUST NOT redeclare these rules.

## Language

English output to user. Chinese only for `AskUserQuestion`. English in all files.

## Code Standards

- Read first. Understand existing patterns. Then write.
- KISS > clever. YAGNI > future-proof. DRY > copy-paste.
- No git commit/branch unless explicitly asked.
- `uv run python` for all Python. Never `.venv/bin/python`.
- Tables: markdown only (`| col | col |`). Never ASCII box-drawing.

## Engineering Principles

### Single Source of Truth (SSoT)

Every piece of state lives in exactly one place. Many readers, many writers — same storage.
- All derived views (UI, cache, index, replicas) MUST be reconstructible from the SSoT.
- The bug is **same-or-similar state stored with different semantics in different places**, causing drift. Example: a `loading` bool, a `state == "LOADING"` enum, an `is_busy` flag — three encodings of one concept, all liable to disagree.
- Schema-first: define data shape (pydantic / typed dict / jsonschema) before behavior.
- Naming where state lives is part of the design. If two answers exist, you haven't designed it.

### Fail Loud, Don't Degrade Silently

Errors must be visible. Silent degradation is the most expensive bug.
- Fallback paths MUST be explicit (log warning + comment + test). Never `try/except: pass`.
- Sentinel defaults (empty string, UTC, empty list) are traps — caller can't tell they got a fallback.
- Before adding `try/except`, ask: "what signal am I swallowing?"
- Missing config / unsupported platform / bad env → crash at startup, not on the Nth user action.
- Real example: `time.tzname[0]` returned `"CST"`, `ZoneInfo("CST")` raised, silent UTC fallback, timestamps off by 8h for weeks. Fix: `tzlocal.get_localzone()`, raise on failure.

### Push, Don't Poll

State changes get pushed via events/reactive/callbacks. Consumers do not poll.
- `while True: check_X(); sleep(N)` → there is almost always a better event source.
- `if state.changed_since_last_check()` → state owner should emit, not wait to be discovered.
- Use framework reactive primitives (Textual `watch_*`, pydantic validators, asyncio Queue, inotify). Don't simulate them.
- Test: can I grep all state-change emits from the owner side? Yes → push. No → redesign.

### Delete > Add

Removing code / features / config has higher priority than adding.
- Before adding, ask: "what can I delete to make room?"
- Dead code / unused config / placeholder abstractions are net liabilities.
- 200 lines → 50 lines: rewrite. 50 lines → 10 lines: also rewrite.
- A config option whose default is the right answer → delete the option.
- Test: PR's net line count negative? 3 PRs in a row positive → time for a cleanup PR.

## Behavior

Bias toward caution over speed. Trivial tasks: use judgment.

### Think Before Coding

Don't assume. Don't hide confusion. Surface tradeoffs.
- State assumptions explicitly. Uncertain → ask.
- Multiple interpretations → present them, don't pick silently.
- Simpler approach exists → say so.
- Confused → stop. Name what's confusing. Ask.

### Simplicity First

Minimum code that solves the problem. No speculation.
- No features beyond what was asked.
- No abstractions for single-use code.
- No "flexibility" not requested.
- No error handling for impossible scenarios.
- Test: "Would a senior engineer say this is overcomplicated?" If yes, simplify.

### Surgical Changes

Touch only what you must.
- Don't "improve" adjacent code, comments, formatting.
- Don't refactor things that aren't broken.
- Match existing style, even if you'd do it differently.
- Notice unrelated dead code → mention it, don't delete it.
- Remove imports/vars/functions YOUR changes orphaned. Leave pre-existing dead code unless asked.
- Test: every changed line traces directly to the user's request.

### Goal-Driven Execution

Define success criteria. Loop until verified.
- "Add validation" → write tests for invalid inputs, make them pass.
- "Fix the bug" → write a test reproducing it, make it pass.
- "Refactor X" → tests pass before and after.

For multi-step tasks, brief plan with verify check per step:
```
1. [Step] → verify: [check]
2. [Step] → verify: [check]
```

Strong success criteria let you loop independently. Weak criteria force constant clarification.

## Commit Format

```
<JIRA-TICKET> - short title
(no ticket → use feat:/xxx or fix:/xxx)

[why]
- reason

[how]
- method

git commit -s
```

1 commit = 1 feature / 1 fix / 1 request. No bundles.

## Logging (Python)

All Python scripts use `loguru`:

| Level | When |
|-------|------|
| `DEBUG` | Internal state, variable dumps |
| `INFO` | Normal operation milestones |
| `WARNING` | Recoverable issues, fallbacks |
| `ERROR` | Failures preventing expected outcome |

Default: `INFO`/`WARNING`/`ERROR`. `-v` flag shows `DEBUG`.

```python
import click, sys
from loguru import logger

@click.command()
@click.option("-v", "--verbose", is_flag=True)
def main(verbose):
    logger.remove()
    logger.add(sys.stderr, level="DEBUG" if verbose else "INFO")
    logger.info("started")
```

- Never bare `print()` for operational output. `print()` only for stdout data (piped/final).
- Every script entry wires `-v` to loguru level.
- Prefer `click` over `argparse`. Prefer `loguru` over stdlib `logging`.

## Frontend

Read https://github.com/VoltAgent/awesome-design-md FIRST before any UI work. Non-negotiable.

## Decision Points

Before `AskUserQuestion` on complex problems: explain in plain Chinese. No jargon, no filler, no politeness padding. Headers/labels stay English.

## Skills (元规则)

**Invocation rule: proportional effort.** Match skill overhead to task complexity.

| Complexity | Action |
|---|---|
| Trivial | Just do it. No skill. (typo, one-liner, lookup, explain) |
| Simple | Direct. Skill only if explicitly requested. (small edit, add function, rename) |
| Medium+ | Invoke relevant skill. (new feature, multi-file, ship, review) |

**Always invoke** when user names a skill or slash command.
**Never invoke** brainstorming/planning skills for tasks under ~10 lines of change.

| Trigger | Skill |
|---------|-------|
| "brainstorm" / "design this" / "新功能想一下" / explore an idea | `wayne-mind-explode` |
| "make a plan" / "plan this feature" / spec → plan | `wayne-plan` |
| "build it" / "implement the plan" / execute a plan | `wayne-work` |
| "review my code" / pre-merge / post-feature review | `wayne-code-review` |
| "commit" / "ship" / "push" | `wayne-ship` |
| "checkpoint" / "save state" / pause-and-resume across sessions | `wayne-checkpoint` |
| "capture lesson" / "记一下" / post-mortem after solving | `wayne-compound` |
| Frontend / UI / landing page / dashboard | `wayne-frontend-design` |
| "save to KB" / "add to knowledge base" / "what do we know about X" / "search KB" | `wayne-manner` |
| Final deliverable for **human** audience: presentation / publication / design doc routed to architect for review | `humanizer-zh` (two-pass audit) |

**Skip `humanizer-zh` for:** AI-consumed docs (CLAUDE.md, plans, specs, agent prompts, internal notes), code comments, commit messages, chat replies. Default = no humanize.

Never use `mcp__claude-in-chrome__*` tools.

## KB

Personal knowledge base at `/work/kb/`. Obsidian-compatible markdown vault.
