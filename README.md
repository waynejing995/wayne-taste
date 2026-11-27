# Wayne Skills

Wayne's control-plane skill library, global invariants, and agent harness config (`omp`, `pi`, Claude Code, Codex). This repository is the single source of truth (`WAYNE_SKILLS_DIR` in `~/.wayne/config.env`); consumers symlink directly here via `bash sync.sh` (see [SYNC.md](SYNC.md)).

## Recommended workflow (2026-11)

The core operating model is **one coordinator + isolated autonomous sessions**, with every stage backed by executable proof instead of prose claims.

```mermaid
flowchart LR
    Req["Raw request"] --> Go["wayne-go<br/>(front door)"]
    Go -->|"small, clear"| Quick["Quick lane<br/>(one task prompt)"]
    Go -->|"medium / large"| Auto["wayne-auto-design-task<br/>(dual proposals w/ Gemini 4 Neon<br/>→ architecture bar → design.md)"]
    Go -->|"brainstorm / spec reversal"| Mind["wayne-mind-explode<br/>(living spec in docs/specs/)"]
    Go -->|"bug / incident"| Triage["wayne-triage"]
    Auto --> TD["wayne-test-design<br/>(U-SEED + Property/Differential<br/>+ locked E2E)"]
    Mind --> TD
    TD --> Plan["wayne-plan<br/>(1 review round → approved)"]
    Plan --> Work["wayne-work<br/>(parallel isolated:true units,<br/>1 commit/unit, simplify, gate)"]
    Work --> Rev["wayne-code-review<br/>(>=1% evidence-backed CRITICAL)"]
    Rev -->|"findings"| Fix["wayne-fix-review"]
    Fix --> Rev
    Rev -->|"clean"| Ship["wayne-ship"]
    Ship --> Comp["wayne-compress<br/>(retro candidates only)"]
    Comp --> Close["Close & cleanup<br/>(teardown, pane kill, ovnfs rm)"]
    Per["Periodic maintenance"] --> Neat["wayne-neat<br/>(docs, memory, comments)"]
    Per --> Sweep["wayne-arch-sweep<br/>(scans, drift, ranked candidates)"]
    Sweep -->|"picked candidate"| Auto
```

### 1. Coordinator & delegation (`wayne-inbox`)
- **Coordinator stays thin**: reads the ledger/RESULTs, routes work, answers questions from evidence, escalates only real decisions to Wayne (plain Chinese, 2–3 options with recommendation), and verifies claimed outcomes at source (`gh pr view`, live runtime checks). Never edits product code inline.
- **One isolated checkout per task**: every new task runs in its own `ovnfs` checkout (`ovnfs new --name <topic> --rev origin/main` from the source repo root) inside a `tern` session, registered via `inbox agent add` with a completion `then` trigger — push, never poll.
- **Check direct user replies**: before re-asking Wayne about a watched session's open question, check all `role: "user"` messages in that session's `.jsonl` since the last check.
- **Model routing**: coding/testing subagents use only the `task` role / `small-model` (never self-promote to Opus or `highend-nonopus` — ask the coordinator for help instead; attached to every brief and injected into agent calls by `omp-config/extensions/coding-worker-model-prompt.ts`); UI/design Gemini steps use `gemini-4-neon` (exact per-host selector in `~/.wayne/CONTEXT.md`); review voices keep their own configured model.

### 2. Design & test bar (`wayne-auto-design-task`, `wayne-test-design`, `wayne-plan`)
- **Medium/large tasks default to `wayne-auto-design-task`**: main model + Gemini 4 Neon draft independent proposals → fused `design.md` (with `## Invariants`) → Gemini interaction/copy review for UI → `wayne-test-design` → `wayne-plan` (single review round) → `wayne-work`. Use `wayne-mind-explode` only when Wayne wants an interview loop or the change reverses a living spec in `docs/specs/`. Urgent production hotfixes with a known root cause skip dual-proposal design and go straight to a fast lite `wayne-plan` + `wayne-work` fix.
- **One architecture bar for every design**: `wayne-auto-design-task` (fusion) and `wayne-mind-explode` (compare, approve, engineering review) judge structure with the same nine yes/no checks in [`wayne-mind-explode/references/architecture-bar.md`](wayne-mind-explode/references/architecture-bar.md). Coupling inside one boundary is cohesion and stays; coupling that crosses a boundary without an interface is the defect. Each check the design depends on is carried as an `R<n>` or an `## Invariants` line, so a test turns red when a later change breaks it. `design.md` fixes the interface shapes; `wayne-plan` does not invent them.
- **Proportional test bar**:
  - **Unit + changed-branch coverage** (`diff-cover`) + **Bug-fix red→green** (seeded fakes must cite the production line that writes that state, else drive the real write path).
  - **Property & Differential tests** (`Hypothesis` / `fast-check`): required (or explicit `none — <reason>`) whenever touching state machines, parsers, migration/rollback round-trips, concurrency monotonicity, or rewrites with an existing oracle; `wayne-plan` never silently downgrades a `property` seed to a single example unit test.
  - **UI changes**: real browser verification + before/after screenshots shown to Wayne.

### 3. Execution, review & verification (`wayne-work`, `wayne-code-review`, `wayne-fix-review`)
- **`wayne-work`**: dispatches ready DAG units in parallel (`isolated: true`), one signed commit per unit (`git commit -s`), runs `wayne-simplify` once on the full diff, then runs an independent whole-diff spec-compliance gate.
- **`wayne-code-review`**: multi-source (structured + Voice 1 + Voice 2 + design-conformance) against the frozen base/head range and repo rule ledger.
  - **Architecture bar on structural diffs**: boundary bypass (deferred imports count), implicit call order or text-as-protocol, pass-through components, tests through internals, and unbounded loops, judged by the same bar the design used.
  - **CRITICAL gate**: requires **≥ 1% estimated per-run probability** (with stated evidence — logs, run counts, load — and only multiplying independent factors) **AND** a serious impact (crash, data loss/corruption, wrong user-visible result, stuck resource). Below 1% is `INFORMATIONAL` with no fix/test requested (security/authz holes excepted).
  - **Eval loop**: regression cases frozen into `eval/wayne-code-review/cases/`.
- **`wayne-fix-review`**: treats comments as hypotheses; verifies at source first, plans fixes in the main model before dispatching workers, never passes raw review comments to subagents.

### 4. Wrap-up: retro & mandatory cleanup (`wayne-compress`, `wayne-inbox/references/delegate.md`)
- After a watched session finishes (`status: done`), run one unattended `wayne-compress` retro round (**top 3** costliest candidates only, apply nothing). Routine candidates are de-duplicated into `~/.wayne/inbox/retro-queue.md` and sent as one consolidated Teams self-chat digest daily at **17:00** (only data-destructive/high-risk findings escalate immediately).
- **Mandatory 4-step `Close`** once all owned PRs merge (or a no-PR run completes retro):
  1. Confirm zero open PRs remain in `rules.yaml`.
  2. **Teardown before killing the pane**: stop/remove session-owned Docker stacks/containers/dev servers, remove `/tmp/<prefix>-*` and secret env files, prune task `context.md` (keep `RESULT*.md`).
  3. `inbox agent close <name> --ack <version> --note "<verified & cleaned>"`, then kill the pane.
  4. Remove the checkout (`ovnfs rm <name>` / `git worktree remove`).

### 5. Maintenance loop (`wayne-neat`, `wayne-arch-sweep`)
- Two sibling skills run between features, and neither replaces design-time judgment. **`wayne-neat`** aligns docs, memory, and comments with the code as it is. **`wayne-arch-sweep`** looks at the structure itself: deterministic scans (import graph including deferred imports, boundary cycles, co-change), drift against the previous sweep, then at most five candidates judged against the architecture bar and ranked by evidence.
- The sweep edits nothing. A picked candidate re-enters the delivery loop as a new `wayne-auto-design-task` run; rejected candidates stay in the sweep ledger so they are not raised again without new evidence.
- Repository-wide gates (import contracts, ratchets, hooks) are earned: each one names the incident or the violation count that bought it.

## Skill index

| Category | Skills |
| --- | --- |
| Entry & routing | `wayne-go`, `wayne-goal-prompt`, `wayne-inbox`, `wayne-checkpoint` |
| Design & planning | `wayne-auto-design-task`, `wayne-mind-explode`, `wayne-frontend-design`, `wayne-test-design`, `wayne-plan` |
| Build & fix | `wayne-work`, `wayne-triage`, `wayne-fix-review`, `wayne-simplify`, `wayne-verify`, `wayne-ship` |
| Review & quality | `wayne-code-review`, `wayne-arch-sweep`, `wayne-compress`, `wayne-distill`, `wayne-context-audit` |
| Context & knowledge | `wayne-context-init`, `wayne-codebase-report`, `wayne-manner`, `wayne-neat`, `wayne-explain`, `waynejing` |
| Authoring & ops | `wayne-skill-forge`, `wayne-skill-optimize`, `wayne-cybernetics`, `wayne-visual-synthesis`, `wayne-rescue-boot` |

## Setup on a new machine

1. Create `~/.wayne/config.env` pointing `WAYNE_SKILLS_DIR` to your clone of this repo (and `WAYNE_KB_DIR` if mounted).
2. Run `bash "${WAYNE_SKILLS_DIR}/sync.sh"` — links `CLAUDE.md`/`AGENTS.md`, skills, `pi-config/` extensions, and `omp-config/` agents/extensions/plugins.
3. Keep personal dev-env/host specifics in `~/.wayne/CONTEXT.md`; keep product terminology inside each repo (e.g. `docs/current_status/glossary.md`). See [SYNC.md](SYNC.md) for the exact symlink topology.
