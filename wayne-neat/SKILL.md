---
name: wayne-neat
description: >
  OCD-level reconciliation of project docs (CLAUDE.md/AGENTS.md, README, docs/) and agent memory
  against actual code state. Two input sources: this conversation AND git log since last sync —
  catches drift the chat didn't surface. MUST trigger on: "neat", "tidy up docs", "sync docs",
  "update memory", "/neat", "/sync", "整理一下", "整理文档", "同步一下", "更新记忆", "梳理一下",
  "收尾", "这个阶段做完了", or any phrase suggesting a milestone where knowledge needs reconciliation.
  Also trigger when the user reports stale docs, conflicting memory, or wants a clean handoff.
  Bare "整理"/"tidy" with prior dev context counts — do not under-trigger.
---

# Wayne Neat

End-of-stage knowledge cleanup. Aligns three layers (agent memory · project root markdown · docs/+README) with what the code actually does. Treats CLAUDE.md as a **rule book**, not a changelog. Reads both this conversation AND `git log` since the last sync.

## Inherits from ~/.claude/CLAUDE.md

This skill inherits the Wayne control-plane invariants and does NOT redeclare them:

- Language Rules (Chinese to user, English in files)
- Engineering Principles (KISS / YAGNI / DRY / SSoT / Fail-Loud / Push-Don't-Poll / Delete>Add)
- Code Standards
- Behavior Baselines (Think Before / Simplicity / Surgical / Goal-Driven)
- Skill invocation rule (proportional effort)

## Origin

Adapted from [`KKKKhazix/khazix-skills/neat-freak`](https://github.com/KKKKhazix/khazix-skills/tree/main/neat-freak) (数字生命卡兹克, MIT). The three-layer audience model, anti-bloat doctrine, and self-checklist are his. Wayne deltas: cross-project (not Chinese-only), `git log` as a second input source, explicit Wayne auto-memory format awareness, and sister-skill boundaries.

## Why this matters

Code can be rewritten anytime. Docs and memory are the only bridge across sessions and across agents. A stale fact in memory becomes the next Agent's wrong premise. A drifted README costs the next teammate (human or AI) hours of confusion.

## Three layers, three audiences — DO NOT collapse

| Location | Audience | Job | Cost of drift |
|---|---|---|---|
| **Agent memory** (Claude Code: `~/.claude/projects/<...>/memory/`) | Future-you across sessions | Personal preferences, non-obvious facts, cross-project references | Next session forgets prior decisions |
| **Project root `CLAUDE.md` / `AGENTS.md`** | The AI in this project, next session | Rules, red lines, command cheat-sheets, env vars, route inventory | Next AI takes wrong path in this repo |
| **Project `docs/` + `README.md`** | **Other people** — human teammates, downstream devs, future AI taking over | Onboarding, architecture, **guides** (deploy / setup / operator / integration), handoff, API reference | Outsiders cannot ramp or operate |

Audiences differ. Jobs do not overlap. "Added 5 device-flow routes to CLAUDE.md" ≠ "downstream consumers integrating the device flow" in `docs/integration-guide.md`. Both must be written.

> Memory location varies by platform — see [references/sync-matrix.md](references/sync-matrix.md). If the current agent has no memory system, skip that layer entirely; spend everything on docs + project markdown.

## CLAUDE.md / AGENTS.md is a rule book, NOT a changelog

The single biggest failure mode: every dev session adds another `> 2026-05-08 X feature shipped, see docs/Y.md` blockquote at the top of CLAUDE.md. After six months the top 200 lines are narrative scrolling the actual rules out of view.

**That narrative belongs in `git log` / `/changelog` / `docs/CHANGES.md`, never CLAUDE.md.**

Test for any candidate line: **if the next AI writing code in this repo doesn't see this line, will it make a mistake?**

| Example | Belongs in CLAUDE.md? | Why |
|---|---|---|
| "Prisma queries only in `modules/**/data/`" | ✅ | Boundary rule, AI must see |
| "rsync single-file deploy needs full target path" | ✅ | Repeatable footgun |
| "Never bare `systemctl stop aihot-worker`" | ✅ | Red line |
| "2026-05-08 timelineAt shipped, see docs/ARCHITECTURE.md §5.4" | ❌ | Mechanism lives in docs; pointer table already covers it |
| "Since 2026-04-30 anonymous reads /, /all" | ❌ | Both history and fact — fact goes in docs/ARCHITECTURE.md §8 + one line in project overview |
| "5/8 fix details for X bug" | ❌ | Single incident — memory or delete |

✅ In CLAUDE.md: hard boundaries, prohibitions, command cheat-sheets, permission model, collaboration flow, "deep docs" pointer table, footgun warnings.
❌ Not in CLAUDE.md: historical narrative, detailed mechanism (lives in docs), single-incident postmortems, bugfix journals, "see docs/Z.md" pointer sentences (the pointer table owns that role).

## Wayne sister-skill boundaries — do not overlap

| Skill | Owns | Don't double-do |
|---|---|---|
| **wayne-neat** (this) | Persistent doc/memory alignment with code state | — |
| `wayne-handoff` | One-shot Chinese chat message for a colleague — today's commits, push state, known issues | Don't write a handoff doc; that's chat-only |
| `wayne-checkpoint` | Resumable working state for **this session's in-flight task** in `.wayne/checkpoints/` | Don't checkpoint inside neat — checkpoint is for paused work, neat is for completed reconciliation |
| `wayne-compound` | Post-mortem KB entries in `/work/kb/` after a hard problem solved | Don't write incident lessons in CLAUDE.md or memory; route to compound |
| `wayne-ship` | Commit + push the docs/memory edits this skill produced | Neat does not commit. End by handing off to wayne-ship |

If a finding belongs to a sister skill's domain, mention it and stop — don't absorb it.

## Doc lifecycle: intermediate → final → delete

Feature implementation produces a trail of intermediate artifacts: brainstorms, RFCs, design drafts v1/v2, plans, decision logs, change requests. These are scaffolding — useful while building, **liability after shipping**. Once the feature lands, only the **final canonical doc** should remain.

### Detection — what counts as intermediate

| Signal | Examples |
|---|---|
| Filename has date prefix | `docs/2026-03-26-trace-plugin-architecture-design.md`, `docs/plans/2026-04-28-001-...-plan.md` |
| Lives under known intermediate dirs | `docs/plans/`, `docs/decisions/`, `docs/brainstorms/`, `docs/rfcs/`, `docs/change-requests/`, `docs/proposals/` |
| Filename contains `draft`, `wip`, `v1`, `v2`, `iter`, `proposal`, `rfc-`, `-plan`, `-decisions` | self-evident |
| Multiple files on same topic | three `*-frontend-realtime-*.md` files = at most one is canonical |
| Body contains "this plan was implemented as commit X" / "implemented in PR #N" / "superseded by Y" | self-marked retire |

### Decision tree — keep or delete

For each candidate intermediate doc, walk:

1. **Is the feature shipped?** (PR merged, code on main, in production)
   - No → keep, it's in-flight.
   - Yes → continue.
2. **Does a final canonical doc exist?** (DESIGN.md, ARCHITECTURE.md, README, `docs/architecture/`, `docs/<feature>.md`)
   - No → **promote**: extract the final-state portions of the intermediate doc into the canonical location, then delete the intermediate.
   - Yes → continue.
3. **Does any code or other doc still reference this intermediate file by path?**
   - Yes → either update the references to point at the canonical doc, or keep this file (rare — usually means the canonical is incomplete).
   - No → **delete**.
4. **Is the user explicitly maintaining ADRs (Architecture Decision Records)?**
   - Yes (e.g., `docs/decisions/` is intentional ADR archive) → keep, but verify the entry is dated, immutable, and reflects the actual decision (not a stale draft).
   - No → goes through steps 1-3 normally.

**Default bias: delete.** Intermediate docs accumulate fast and rot faster. The canonical doc + `git log` + `git show` already preserve the design history.

### Known issues lifecycle

`docs/known-issues/` (or equivalent: `KNOWN_ISSUES.md`, `docs/issues/`, `BUGS.md`) needs active maintenance — every entry is a promise the bug exists. Stale entries are worse than missing ones (readers waste time investigating already-fixed bugs).

For each known-issues entry, check:

| State | Action |
|---|---|
| Bug fix shipped (commit / PR merged) | **Delete the entry** (or move to `docs/CHANGES.md` if user maintains a changelog) |
| Workaround documented but root cause unresolved | Keep — but verify the workaround still works |
| Issue says "TODO investigate" + > 30 days old + no recent commits touching the area | Flag in summary as "未处理" — ask user whether to keep or close |
| Entry has no date | Add a date, or delete if you can't tell when it was filed |
| Multiple entries about the same root cause | Merge into one |

When the conversation included a fix that resolves a known-issues entry, **delete the entry in Phase 3**. Don't leave it for "later cleanup."

### Guides — record every deploy/setup path

A "guide" is any doc that tells a reader **how to do something**. Common subtypes:

| Guide subtype | Audience | Content |
|---|---|---|
| `setup-guide` / `initial-setup` / `quickstart` | First-time developer or operator | Clone → install deps → env vars → first run |
| `deploy-guide` | Operator or release engineer | Build → push → migrate → smoke → rollback |
| `dev-guide` / `developer-guide` | Contributor | Local dev loop, test commands, branching, PR flow |
| `operator-guide` (formerly "runbook") | On-call / SRE | Smoke commands, troubleshooting, env vars, restart procedures, incident response |
| `integration-guide` | Downstream consumer of this project | API usage, SDK examples, error codes, auth |

**Rule: every distinct deploy or setup path needs a guide.** Multiple deploy targets (local, staging, prod, customer-onsite)? Each gets a guide section or its own file. Multiple setup paths (Linux dev, Mac dev, Docker dev)? Same.

When neat scans, verify:
- [ ] Every script under `scripts/deploy*` / `scripts/install*` / `Makefile` deploy targets has a corresponding guide
- [ ] Every env var in `.env.example` appears in setup-guide OR operator-guide
- [ ] No two guides give contradictory steps for the same task — pick one canonical, others link to it
- [ ] Guides use absolute paths and exact command strings (not "configure as needed")

If `docs/operator-runbook.md` exists, **rename to `docs/operator-guide.md`** for consistency, update inbound references.

## Wayne auto-memory format (must respect)

Memory files at `~/.claude/projects/<encoded>/memory/` follow this exact shape. Preserve it on edits:

```markdown
---
name: {short-kebab-case-slug}
description: {one-line summary, used for relevance retrieval}
metadata:
  type: {user | feedback | project | reference}
---

{body — for feedback/project, lead with the rule/fact, then **Why:** and **How to apply:** lines.
Link related memories with [[other-memory-name]].}
```

Hard rules:

- `MEMORY.md` is an **index**, not a memory. Each line: `- [Title](file.md) — one-line hook`. No frontmatter. Lines past 200 get truncated by the harness — keep tight.
- `description:` is the retrieval signal — make it specific, not generic.
- `[[name]]` links to other memory slugs. A `[[name]]` not yet matching a file is fine — it marks future work.
- Do not write duplicate memories. Grep before adding.
- Update or remove memories that turn out wrong. Stale memory > no memory.

When neat finds a memory file violating this shape (missing frontmatter, narrative changelog, > 100 lines, contradicts another), fix it.

## Parallelization with subagents

Wayne-neat is I/O-heavy (`ls`, `find`, reading many `.md`, `git log`, `git diff`) — perfect for subagent fan-out. Dispatch in **two phases**:

| When | Agent type | What | Why parallel |
|---|---|---|---|
| Phase 1 inventory, **per project touched** | `Explore` (read-only) | `ls` + read every `.md` in project, return file inventory + their current claims | Each project is independent; no shared state |
| Phase 2, alongside conversation review | `general-purpose` | Read `git log <range>` + `git diff --stat`, list public-surface changes (routes, env vars, schemas, CLI flags) | Independent of conversation review; both feed into change list |
| Phase 4 self-check, **per project** | `Explore` | Verify each path/command/env var/route mentioned in updated CLAUDE.md actually exists in code | Pure read; per-project parallelizable |

**Do NOT parallelize Phase 3 edits** — single editor keeps the mental model coherent and avoids file-level conflicts.

**When to skip subagents** (proportional effort):
- Single project · no `git log` since last sync · short conversation → just do it inline
- < 5 doc files total → inline reading is faster than agent overhead

**Dispatch rule**: in a single message, fire all independent agents in parallel (multiple Agent tool calls in one block). The main agent synthesizes their reports — agents return summaries, not raw file contents, to protect the main context window.

**Example dispatch (Phase 1, three projects touched):**

```
Agent({ subagent_type: "Explore", description: "TRACE doc inventory",
        prompt: "ls /home/wayne/TRACE/docs/ recursively. Read every .md
                 (excluding /node_modules /.git). Return a table:
                 file | one-line topic | claims that depend on code
                 (env vars, route paths, CLI commands, public APIs).
                 Under 400 words." })
Agent({ subagent_type: "Explore", description: "ProjectB doc inventory", ... })
Agent({ subagent_type: "Explore", description: "ProjectC doc inventory", ... })
```

All three in one message → run concurrently. Main agent gets three summaries, builds the unified file checklist.

## Execution flow

### Phase 0 — Size audit (anti-bloat, runs FIRST)

`wc -l` the candidates before any sync action:

| File | Soft limit | If exceeded |
|---|---|---|
| `CLAUDE.md` / `AGENTS.md` (per project) | ~300 lines / ~15KB | Slim first: scan top blockquote / narrative segments → delete or migrate to docs. Keep project overview to 1-3 lines + key cheat-sheets only |
| `~/.claude/CLAUDE.md` (global) | ~500 lines | Same drill, even stricter — global is loaded into every project |
| `MEMORY.md` (memory index) | ~150 lines (hard truncate at 200) | Find superseded entries, single-incident postmortems, mechanism details that code already documents → delete |
| Single memory file | ~100 lines | Usually means stuffing multiple things or written as incident postmortem → split or delete (most postmortems have no reuse value) |
| `docs/<single>.md` | ~1500 lines | Split into multiple files with an index |

**Bloat is highest priority — higher than completing this session's incremental sync.** A bloated CLAUDE.md actively hurts the next AI (rules pushed past the prompt-attention zone). Sync-on-top-of-bloat is wasted work.

**Order:** slim first (mindset: "what doesn't belong"), then sync (mindset: "what's missing"). Never blend the two passes.

### Phase 1 — Inventory (mechanical enumeration, no shortcuts)

**`ls` first, judge later.** **If ≥ 2 projects touched, fan out via `Explore` subagents (one per project) — see Parallelization section above.** Single project: do inline.

1. List agent memory files (if applicable):
   - Claude Code: `ls ~/.claude/projects/<...>/memory/` and read `MEMORY.md` + every referenced `.md`
   - Other agents: see `references/sync-matrix.md` for paths
2. For every project this conversation touched:
   - `ls <project-root>/` — confirm root layout
   - `ls <project-root>/docs/ 2>/dev/null` — enumerate every doc (record absence too)
   - `find <project-root> -maxdepth 2 -name "*.md" -not -path "*/node_modules/*" -not -path "*/.git/*"` — catch stragglers
   - Read `README.md`, project root markdown (CLAUDE.md / AGENTS.md), every `docs/*.md`
3. Read global agent config (`~/.claude/CLAUDE.md`, `~/.codex/AGENTS.md`)
4. Recall the entire conversation

**Internal output: a checklist** — for every file, mark "evaluated / will edit / no change". Missing one is the most common failure mode here.

### Phase 2 — Identify changes (TWO input sources)

Drift sources are not just "what we discussed." Always merge two streams:

**Source A — conversation deltas** (what we did and decided this session)

**Source B — `git log` since last sync** (what landed that the chat may not have surfaced):

```bash
# pick whichever scopes the work
git log --oneline main..HEAD
git log --oneline -30
git log --oneline --since="3 days ago"
git diff --stat <base>..HEAD
```

For each commit not obviously discussed: read the diff summary, check whether it touches a public surface (route, env var, schema, command, CLI flag, public function signature). If yes → it has a doc-layer obligation we may have skipped.

**Parallelization**: dispatch the git log scan as a `general-purpose` subagent in the same message as Phase 1 inventory agents — it has no dependency on conversation review and runs concurrently. Subagent returns a list of public-surface changes; main agent merges with conversation deltas.

**Change → file mapping** — see [references/sync-matrix.md](references/sync-matrix.md) for the full table. Common shapes:

- New API/route → CLAUDE.md route inventory + integration-guide + architecture Routes
- New/renamed env var → CLAUDE.md env table + operator-guide + downstream integration-guide
- New DB table/column → CLAUDE.md + architecture Data Model
- Large feature (multi-file) → all of the above + new architecture chapter + handoff "done" list
- **Cross-project change** → both upstream AND downstream docs (most-missed scenario)
- Memory layer: relative time → absolute date; stale fact → fix; duplicate → merge; completed todo → delete

### Phase 3 — Actually edit (use the tools, not descriptions)

Real `Edit` / `Write` / file delete commands. "How I would change it" doesn't count.

**Order:** docs/ first (external impact highest) → CLAUDE.md/AGENTS.md → memory last. If interrupted mid-way, external readers see the latest aligned state.

**Editing principles:**

- **Subtract before add** (most important): per sync action, CLAUDE.md / AGENTS.md net delta > +30 lines is a red light — almost certainly writing narrative instead of rules. Re-audit: is this line "rules the next AI must see" or "memo from last session to next session"? The latter is the disease.
- **Merge over append**: when new info updates old, edit the old entry. Before adding, grep for the same keyword.
- **Delete over preserve**: completed temp plans, overturned decisions, superseded project memories, incident-narrative postmortems → delete.
- **Precise over verbose**: one memory entry = one fact.
- **Absolute time always**: `2026-04-29`, never "today" / "recently" / "last week".
- **Reader-facing**: docs/ readers are first-time outsiders with 5 minutes to spare. Write accordingly.
- **Don't blend audiences**: CLAUDE.md doesn't quote docs/, docs/ doesn't say "I remember last time…".
- **Pointers don't duplicate**: a fact detailed in docs/ appears in CLAUDE.md only inside the "deep docs" pointer table — not also as a narrative blurb in the overview.

**Global config: extreme restraint.** `~/.claude/CLAUDE.md` only changes when the user explicitly stated a **cross-project core principle** in the conversation. Project-specific details never reach global.

**Adding a new capability typically requires four edits:**

1. **integration-guide / external-view doc**: how to use (curl / SDK example / error codes)
2. **architecture**: how it works (data flow, state machine, design tradeoffs)
3. **operator-guide** (formerly "runbook"): how to operate (smoke commands, troubleshooting, env vars)
4. **handoff / CHANGELOG**: what's done

API tables, env-var tables, glossaries are high-frequency structured lookups — **must be always-current.**

### Phase 4 — Self-check (every box must tick)

**Anti-bloat (check first; fail = go back to slim pass):**
- [ ] CLAUDE.md / AGENTS.md net delta ≤ +30 lines
- [ ] No new "X shipped, see docs/Y.md" blockquote narrative entries
- [ ] No mechanism details copied from docs/ into CLAUDE.md
- [ ] No memory file > 100 lines

**Completeness (check second):**
- [ ] Every file from Phase 1 marked "no change" or "edited"
- [ ] Every link in MEMORY.md points to an existing file
- [ ] Every memory file's `description:` matches its current body
- [ ] Memory files don't contradict each other
- [ ] Paths / commands / tools / env vars referenced in CLAUDE.md actually exist in code
- [ ] README install/run steps match code reality
- [ ] **New API route → present in BOTH integration-guide AND architecture**
- [ ] **New env var → present in BOTH operator-guide AND project root markdown**
- [ ] **Deploy/setup steps changed → deploy-guide / setup-guide updated**
- [ ] **Resolved known-issues entries deleted from `docs/known-issues/`**
- [ ] **Intermediate design docs / plans / drafts for shipped features removed (see "Doc lifecycle" section)**
- [ ] **New DB table → present in BOTH architecture Data Model AND project root markdown**
- [ ] **Cross-project impact: downstream project docs also updated**
- [ ] No relative time leftovers: `grep -E "today|yesterday|recently|last week|今天|昨天|刚刚|最近|上周"` returns clean
- [ ] **Wayne memory format**: every memory file has valid frontmatter (`name`, `description`, `metadata.type`)
- [ ] **`MEMORY.md` is an index, not a memory** — no frontmatter, one line per entry

**Drift coverage (Wayne addition):**
- [ ] `git log` since last sync surveyed; commits touching public surfaces verified to have doc updates
- [ ] If `LEGACY_*` markers exist, condition checked — retire if met (per `~/.claude/projects/<...>/memory/feedback_legacy_marker.md`)

If any box fails, go back. "Close enough" defeats the skill.

**Parallelization**: the path/command/env-var existence checks (lines marked "actually exist in code") fan out cleanly — one `Explore` subagent per project, each verifying its own CLAUDE.md claims against the codebase. Run in parallel after Phase 3 edits land.

### Phase 5 — Summary + handoff to wayne-ship

After all edits, output to chat (Chinese, per Wayne global rule):

```
## 同步完成

### 记忆变更
- 更新：xxx (原因)
- 新增：xxx
- 删除：xxx (原因)

### 文档变更（按项目分组）
- <project>/CLAUDE.md — xxx
- <project>/docs/integration-guide.md — xxx

### 未处理
- xxx（为什么没处理 — 通常是要用户决定的矛盾）

### 下一步
跑 `wayne-ship` 把这次 doc 同步落成一个 commit。
```

Only list entries that actually changed. Empty sections drop.

## Special cases

**Project has no README / CLAUDE.md / AGENTS.md**: if the project has runnable code, create. Still in vibe stage, skip but mention in summary.

**Conversation produced no new facts**: still audit existing memory and docs for stale / conflicting / relative-time issues. The audit itself has value.

**Two memories conflict and you can't decide**: list under "未处理" for the user. **This is the only case requiring user input** — everything else, decide and act.

**Cross-project conversation**: every project gets a full Phase 1 (ls + read docs) pass. Don't assume one project's docs being current implies another's.

**Found drift from a prior sync**: fix it. "That wasn't this conversation" doesn't apply — you are the persistent editor of these projects.

## References

- [references/sync-matrix.md](references/sync-matrix.md) — full "change type → which files to edit" table + agent memory paths per platform
