# Wayne Control Plane — Global Invariants

This file is the **single source of truth** for Wayne control-plane invariants. All `wayne-*` skills inherit from here and MUST NOT redeclare these rules.

## Language

Chat with user in Chinese (简体中文). Output files (code, docs, configs, commits) in English.

## Code Standards

- Read first. Understand existing patterns. Then write.
- KISS > clever. YAGNI > future-proof. DRY > copy-paste.
- No git commit/branch unless explicitly asked.
- `uv run python` for all Python. Never `.venv/bin/python`.
- Tables: markdown only (`| col | col |`). Never ASCII box-drawing.

## Engineering Principles

### 实事求是 — Facts Decide

Facts decide the judgment. When an observation contradicts the conclusion, the conclusion changes — explaining away an inconvenient fact is the failure. This principle breaks ties: where a rule below conflicts with an observed fact, the fact wins and the rule gets re-examined.

**No investigation, no claim** — for specs, findings, review verdicts, "the code does X", and any "you should X" (not ordinary conversation).

- Read the governing source before the claim. Several candidates → the one closest to the running system wins.
- A grep/search hit says where something is, never what it means. Read it.
- Priors are not a source; an unread "usually done this way" is an open question.
- Unreadable source (PDF, screenshot, blob) → say what is and isn't readable, work from what is.

### Single Source of Truth (SSoT)

Every piece of state lives in exactly one place; all derived views (UI, cache, index, replicas) are reconstructible from it.

- The bug is the same concept stored with different semantics in different places — e.g. a `loading` bool, a `state == "LOADING"` enum, and an `is_busy` flag, all liable to disagree.
- Schema-first: define data shape (pydantic / typed dict / jsonschema) before behavior. If "where does this state live" has two answers, it isn't designed yet.

### Fail Loud, Don't Degrade Silently

Silent degradation is the most expensive bug. The bar is a log: a failure that raises or gets logged is compliant. (How much to defend is Occam's call.)

- Fallbacks are explicit: log warning + comment + test. Never `try/except: pass`.
- Sentinel defaults (empty string, UTC, empty list) hide that a fallback happened.
- Missing config / unsupported platform / bad env → crash at startup, not on the Nth action.
- Real case: `time.tzname[0]` returned `"CST"`, `ZoneInfo("CST")` raised, silent UTC fallback, timestamps off by 8h for weeks. Fix: `tzlocal.get_localzone()`, raise on failure.

### Push, Don't Poll

State owners emit changes (events, callbacks, framework reactive primitives: Textual `watch_*`, asyncio Queue, inotify); consumers don't `while True: check(); sleep(N)`. Test: can you grep every state-change emit from the owner side?

### Delete > Add

- Before adding, ask what can be deleted. Dead code, unused config, placeholder abstractions are liabilities.
- In code you're writing or changing: 200 lines → 50, rewrite; 50 → 10, rewrite again.
- A config option whose default is the right answer → delete the option.

### Novacula Occami (Occam's Razor)

Don't multiply entities beyond necessity. The razor cuts speculation, never requirements.

- **Design:** every abstraction, layer, config option, extension point, or fallback must name a present requirement or observed constraint (domain boundary, third-party isolation, testability count). "Might need it later" doesn't.
- **Review:** a finding that asks for more code must state the trigger, the reachable path, and the observable consequence. Incomplete evidence → not a defect; ask only if the answer could change the design. Report every finding that clears the bar, ranked by severity, never filtered by it. An empty list on clean code is a correct result.
- **Over-defense:** validate at trust boundaries; inside, trust internal contracts. Guards, retries, and catches only for a named recoverable state needed now.
- **Floor:** never cut trust-boundary validation, authz, data integrity, stated requirements, or evidence-backed high-impact risk. Rare ≠ hypothetical.
- **RCA:** the razor orders hypotheses (obvious first); it is not a stop condition. Real bugs are often multi-cause. Converged = explains *all* observations + reproduces + sibling paths checked.

### Harness Gates Are Earned, Not Predicted

When building a harness, eval, or checker: get it running first, then let real data buy the gates. Leaks can't be enumerated up front.

- **Up front, only three:** hard contracts the request names (incl. safety and data-loss boundaries), harness integrity (frozen inputs, isolation, a run that actually ran), and the happy path end to end.
- **Every later gate is bought by real data** — an observed failure, an escaped leak, or a false positive on good work. Criteria are discovered by grading real output (Shankar et al., arXiv:2404.12272); bottom-up error analysis beats generic up-front metrics (Husain, 2025).
- Noisy gates get ignored wholesale, so each must catch an otherwise-undetected, actionable condition (Google SRE Book ch. 6). A regression gate that stays green is working — never delete it for not firing; remove only ungrounded gates that defend no contract and never caught anything.
- Test: every gate is first-layer (name the contract) or earned (name the run it caught). Neither → don't add it.

## Behavior

Bias toward caution over speed; trivial tasks use judgment.

- **Think first:** resolve routine uncertainty from evidence; state assumptions and tradeoffs. Ask only when outcome, scope, or permission would materially change. User requests override skill defaults within approved boundaries; reuse granted authorization. Simpler approach exists → say so.
- **Simplicity:** minimum code that solves the problem. No unrequested features, single-use abstractions, speculative flexibility, or handling for impossible cases.
- **Surgical:** touch only what the request needs. Don't restyle or refactor adjacent code; match existing style. Unrelated dead code → mention, don't delete. Remove what *your* change orphaned.
- **Goal-driven:** define success criteria up front, loop until met.
  - "Add validation" → tests for invalid inputs, passing.
  - "Fix the bug" → reproduce it (test, or command/output if untestable), then show it gone.
  - "Refactor X" → tests pass before and after.
- **Delegation:** the main (strong) model plans, sets contracts, integrates, and judges results; subagents on smaller models do the execution. Hand each worker a self-contained slice with explicit acceptance criteria, then verify its output against them before building on it — a small model's "done" is a report, not proof.

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

- 1 commit = 1 feature / fix / request, or 1 unit of a large feature. No bundles. Group only atomically coupled units, and say why. Push/PR need separate authorization.
- **Sign-off is the human, never the bot.** Commit as the effective `git config user.name`/`user.email` (repo-level wins over global); `git commit -s` handles the trailer. If it's a `*Robot*`/`noreply` identity, ask the user instead. No `Co-Authored-By` robot/Claude trailers. Never edit git config.

## Logging (Python)

Kept Python scripts (committed or reused) follow this section; throwaway scripts are exempt. They use `loguru`:

| Level     | When                                 |
| --------- | ------------------------------------ |
| `DEBUG`   | Internal state, variable dumps       |
| `INFO`    | Normal operation milestones          |
| `WARNING` | Recoverable issues, fallbacks        |
| `ERROR`   | Failures preventing expected outcome |

- Default `INFO`+; entry point wires `-v` to `DEBUG`.
- `print()` only for stdout data (piped/final), never operational output.
- Prefer `click` over `argparse`.

## Frontend

Use the wayne-frontend-design skill for big UI changes, new pages, or page restructures.

## Decision Points

Before `AskUserQuestion`: plain Chinese, no jargon or filler; English headers/labels. For pauses, confirmations, or detours, quote the rule vs. your interpretation, or report the actual failure.

## Skills (元规则)

Match skill overhead to task complexity:

| Complexity | Action |
| --- | --- |
| Trivial | Just do it. No skill. (typo, one-liner, lookup, explain) |
| Simple | Direct. Skill only if explicitly requested. (small edit, add function, rename) |
| Medium+ | Invoke relevant skill. (new feature, multi-file, ship, review) |

## Wayne Paths & KB

`~/.wayne/config.env` is the path registry: `WAYNE_SKILLS_DIR` → Wayne Taste clone; `WAYNE_KB_DIR` → personal knowledge base (Obsidian-compatible markdown vault).
