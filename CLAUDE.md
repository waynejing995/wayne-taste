# Wayne Control Plane — Global Invariants

Single source of truth for Wayne invariants. `wayne-*` skills inherit these and MUST NOT redeclare them.

## Basics

- Chat in Chinese (简体中文). Files (code, docs, configs, commits) in English.
- Read existing patterns before writing; match them. KISS, YAGNI, DRY.
- No git commit/branch unless explicitly asked. Running `wayne-work` is that ask for its one commit per unit; it never branches or pushes.
- `uv run python` for all Python. Never `.venv/bin/python`.
- Tables: markdown only. Never ASCII box-drawing.
- Kept Python scripts (committed or reused; throwaway exempt): `loguru`, default `INFO`+, entry point wires `-v` to `DEBUG`; `click` over `argparse`; `print()` only for stdout data, never operational output.

## Principles

### 实事求是 — Facts Decide

An observation that contradicts the conclusion changes the conclusion; never explain it away. Tie-breaker: a rule that conflicts with an observed fact loses and gets re-examined.

**No investigation, no claim** — for specs, findings, review verdicts, "the code does X", and "you should X" (not ordinary conversation).

- Read the governing source before the claim; several candidates → the one closest to the running system.
- A grep hit is a location, not a reading. Priors are open questions, not sources.
- Unreadable source → say what is and isn't readable; work from what is.

### Single Source of Truth

Each piece of state lives in one place; derived views (UI, cache, index, replicas) are reconstructible from it. The bug is one concept stored in several places with different semantics. Schema first: define the data shape before behavior; two answers to "where does this state live" → not designed yet.

### Fail Loud

A failure raises or gets logged — that is the whole bar; how much to defend is Occam's call. Fallbacks are explicit: log warning + comment + test. Never `try/except: pass`; no sentinel defaults (empty string, UTC, empty list) hiding a fallback. Missing config, unsupported platform, bad env → crash at startup.

### Push, Don't Poll

State owners emit changes through events, callbacks, or the framework's reactive primitives; consumers never `while True: check(); sleep(N)`. Test: every state-change emit is greppable from the owner side.

### Delete > Add

Before adding, look for what to delete: dead code, unused config, placeholder abstractions. Rewrite code you touch whenever that shrinks it. A config option whose default is the right answer → delete the option.

### Novacula Occami

The razor cuts speculation, never requirements.

- **Design:** every abstraction, layer, config option, extension point, or fallback names a present requirement or observed constraint (domain boundary, third-party isolation, testability). "Might need it later" doesn't count.
- **Review:** a finding that asks for more code states the trigger, the reachable path, and the observable consequence; otherwise it is not a defect — ask only if the answer could change the design. Report every finding that clears the bar, ranked by severity, never filtered by it. An empty list on clean code is correct.
- **Over-defense:** validate at trust boundaries; inside, trust internal contracts. Guards, retries, and catches only for a named recoverable state needed now.
- **Floor:** never cut trust-boundary validation, authz, data integrity, stated requirements, or evidence-backed high-impact risk. Rare ≠ hypothetical.
- **RCA:** the razor orders hypotheses; it is not a stop condition. Bugs are often multi-cause. Converged = explains all observations + reproduces + sibling paths checked.

### Harness Gates Are Earned

Building a harness, eval, or checker: get it running first; real data buys the gates.

- Up front, only three: hard contracts the request names (incl. safety and data-loss boundaries), harness integrity (frozen inputs, isolation, a run that actually ran), the happy path end to end.
- Every later gate names the run that earned it: an observed failure, an escaped leak, or a false positive on good work. Neither a contract nor a run → don't add it.
- Each gate catches an otherwise-undetected, actionable condition; noisy gates get ignored wholesale.
- Never delete a regression gate for staying green; remove only gates that defend no contract and never caught anything.

## Behavior

- Caution over speed; trivial tasks use judgment.
- **Think first:** resolve routine uncertainty from evidence; state assumptions and tradeoffs. Ask only when outcome, scope, or permission would materially change. User requests override skill defaults within approved boundaries; reuse granted authorization. Simpler approach exists → say so.
- **Irreversible side effects** (deleting data, deploying, sending external messages, publishing, flashing devices): confirm an explicit authorization covers that action first; reuse a grant that already does. State what cannot be undone and the mitigation used (backup, dry-run, staged exposure) — mitigation limits exposure, it does not make the action reversible. Applies at any task size.
- **Simplicity:** minimum code that solves the problem. Nothing unrequested, speculative, single-use-abstracted, or defending impossible cases.
- **Surgical:** touch only what the request needs; match existing style. Unrelated dead code → mention, don't delete. Remove what your change orphaned.
- **Goal-driven:** define success criteria up front and loop until met. Bug → first add a minimal test on the failing path that reproduces it, then fix until it passes. Refactor → tests pass before and after.
- **Delegation:** the main model plans, sets contracts, integrates, and judges; subagents on smaller models execute self-contained slices with explicit acceptance criteria. Verify their output before building on it — "done" is a report, not proof.
- **Skills:** trivial or simple task → do it directly, skill only if asked. Medium+ (new feature, multi-file, ship, review) → invoke the relevant skill.
- **Decision points:** before `AskUserQuestion`, plain Chinese, no jargon or filler; English headers/labels. For a pause, confirmation, or detour, quote the rule vs. your interpretation, or report the actual failure.
- **Frontend:** big UI change, new page, or page restructure → `wayne-frontend-design` skill. Never give a UI component a second label or description; the layout does the explaining.

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

- 1 commit = 1 feature / fix / request, or 1 unit of a large feature. No bundles; group only atomically coupled units, and say why. Push/PR need separate authorization.
- Sign-off is the human, never the bot: commit with `-s` as the effective `git config user.name`/`user.email` (repo-level wins over global). `*Robot*`/`noreply` identity → ask the user. No `Co-Authored-By` robot/Claude trailers. Never edit git config.

## Wayne Paths

- `~/.wayne/config.env` is the path registry: `WAYNE_SKILLS_DIR` → Wayne Taste clone; `WAYNE_KB_DIR` → personal knowledge base (Obsidian-compatible markdown vault).
- Wayne working state (decision logs, spec candidates, test matrices, plans, checkpoints, triage evidence) lives in `~/.wayne/projects/<origin-slug>/`, one per project, shared by its worktrees — never in the repository. Resolve it with `_shared/scripts/wayne-state-dir.sh`; layout in `_shared/pipeline-id-contract.md`. Only the approved spec (`docs/specs/<topic>.md`) and `GLOSSARY.md` enter the repo, committed by `wayne-mind-explode` after its reviews.
