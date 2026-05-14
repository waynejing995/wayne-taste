# Sync Matrix — change type → which files to edit

When unsure "this change touches what?", consult this table. Two directions to scan:
- **Forward** (what to add): given a code-layer change, which doc-layer files need updates?
- **Reverse** (what to remove): given current CLAUDE.md / memory state, what does NOT belong?

## Reverse — what to delete from CLAUDE.md / memory

CLAUDE.md / AGENTS.md is not a changelog. Anti-patterns to strip:

| Anti-pattern | Action |
|---|---|
| `> 2026-MM-DD X feature shipped, see docs/Y.md` blockquote narrative | Delete — pointer role belongs to the "deep docs" pointer table; narrative belongs in `git log` / `/changelog` / `docs/CHANGES.md` |
| Mechanism / data flow / scoring formulas duplicated from docs/ | Delete — AI editing this area will read docs anyway; CLAUDE.md keeps boundary rules only |
| "New feature shipped" narrative ≥ 7 days stable | Either fold into project overview or delete pure history |
| Single-incident postmortem details ("X service died 30min on YYYY-MM-DD because Z") | Keep one-line red-line rule; details to `docs/PLAYBOOK.md` or delete |
| Superseded "intermediate state" narrative ("changed X on 5/6 then changed it again on 5/8") | Keep only the final-state rule; delete intermediate history |
| Single memory file > 100 lines, all incident postmortem | Distill to one ≤ 30-line "rule + Why + How to apply"; delete rest |
| Memory entry containing "superseded by X" / "deprecated, kept for history" | 99% of the time, actually deletable |
| Intermediate design doc / plan / draft / RFC under `docs/{plans,decisions,brainstorms,rfcs,proposals,change-requests}/` for a **shipped** feature | Promote final-state portions to canonical doc (DESIGN.md / ARCHITECTURE.md / `docs/<feature>.md`), then delete the intermediate. See SKILL.md "Doc lifecycle" section |
| Resolved entry in `docs/known-issues/` (fix shipped) | Delete the entry (or move to `docs/CHANGES.md` if changelog maintained). See SKILL.md "Known issues lifecycle" section |
| Date-prefixed file like `docs/2026-MM-DD-*.md` whose feature has shipped and canonical doc exists | Delete unless explicitly an ADR archive |
| Code comment that narrates what the code obviously does (`// returns the user count`) | Delete (Wayne convention: default no comments, code self-describes) |
| Code comment that contradicts the adjacent code (`// throws on null` next to a function that returns null silently) | Fix to match code OR fix code to match comment — pick one based on whether the comment was a load-bearing WHY |
| `// TODO`, `# TODO`, `// FIXME` with met trigger condition (date passed, dependency upgraded, feature shipped) | Resolve and delete; if work was done, ensure the fix is captured in commit / docs first |
| `LEGACY_DELETE_WHEN_RETIRE:` marker whose condition is now met | Delete the marked code AND the marker in one edit (per Wayne legacy convention) |
| Stale identifier reference in comments (`// see foo()` after rename to `bar()`) | Mechanical update — rename is mechanical |
| Docstring / parameter comment that no longer matches the current function signature | Sync to current signature (signature is the source of truth) |
| Module file header that describes a no-longer-true architecture (`# Auth via JWT` after switch to sessions) | Rewrite to current state, or delete if the module is now self-evident |

Test: **if the next AI writing code doesn't see this line, will it make a mistake?** If not, delete or migrate.

## Forward — code change → doc files to update

| What happened in conversation | Files to edit (by audience) |
|---|---|
| New API / route | Project root markdown route inventory · `docs/integration-guide.md` API table · `docs/architecture.md` Routes section |
| New / renamed env var | Project root markdown env table · `docs/operator-guide.md` env section · `docs/integration-guide.md` (if downstream configures it) · `.env.example` |
| New DB table / column | Project root markdown DB section · `docs/architecture.md` Data Model |
| New / changed user flow | Project root markdown user flow · README CLI examples · `docs/handoff.md` What Exists Today |
| Large feature (multi-file) | All of the above + new `docs/architecture.md` chapter + `docs/handoff.md` done list + **delete intermediate plans/decisions for the shipped scope** |
| New term / renamed concept | `docs/integration-guide.md` glossary (if exists) + global search-replace old term |
| Deploy params / infra change | `docs/deploy-guide.md` · project root markdown deploy section · `docs/operator-guide.md` if it changes operations |
| Setup steps changed (new dep, new bootstrap script, new tooling version) | `docs/setup-guide.md` (or `quickstart` / `initial-setup`) · README install block · `docs/dev-guide.md` |
| Downstream integration shape changed | Downstream project's `docs/<integration>.md` · upstream project's `integration-guide.md` |
| New CLI flag on a script | README usage block · `docs/operator-guide.md` if operator-facing · `docs/dev-guide.md` if dev-facing |
| Schema change (Pydantic / TypeScript types at API boundary) | `docs/integration-guide.md` schema section · architecture if it changes data flow |
| New worker / background job / cron | `docs/operator-guide.md` (how to inspect / restart) · architecture (what triggers it) |
| New permission / role / auth scope | `docs/integration-guide.md` auth section · project root markdown permission model · `docs/operator-guide.md` (how to grant) |
| **Bug fix shipped that resolves a known-issues entry** | **Delete the entry from `docs/known-issues/`** · optionally append to `docs/CHANGES.md` |
| **Feature shipped that had intermediate design / plan / decision docs** | **Promote final-state portions to canonical doc, then delete intermediates** under `docs/plans/`, `docs/decisions/`, `docs/brainstorms/`, `docs/rfcs/`, `docs/change-requests/` |
| New deploy target (local / staging / prod / customer-onsite) | New section in `docs/deploy-guide.md` OR new `docs/deploy-<target>.md` |
| New setup path (Linux / Mac / Docker / WSL) | New section in `docs/setup-guide.md` OR new `docs/setup-<env>.md` |
| Function / method renamed | `grep -rn "<old-name>"` across **all** comments (`//`, `#`, `/* */`, docstrings) — update or delete every reference |
| Function / method deleted | Same grep + delete every comment that refers to it; check for orphaned `// see X()` or `# called by X()` lines |
| Public API signature changed (params, return type) | Docstring on the function · parameter comments · any caller-side comment explaining what was passed |
| Algorithm replaced (e.g., switched sort, switched hash) | WHY comment about the old algorithm becomes stale — rewrite to explain new choice, or delete if self-evident |
| Code path / branch / module deleted | TODOs / FIXMEs / LEGACY markers anchored to that path — delete with the code |
| Bug fixed that had a `// FIXME: <bug>` near it | Delete the FIXME in the same commit as the fix (don't let it linger) |

## Memory-layer changes

| Situation | Handling |
|---|---|
| Stale fact | Edit the memory file, also update its `description:` |
| Relative time ("today" / "recently" / "今天") | Convert to absolute date (`2026-04-29`) |
| Duplicate (multiple memories about same thing) | Merge into one, update `MEMORY.md` index line |
| Completed todo | Delete — KB is not a history archive |
| Overturned decision | Delete old, keep new |
| Single-conversation throwaway context | Delete |
| Memory body contradicts its `description:` | Either rewrite description or rewrite body — they must agree |
| Memory cites a `[[other]]` link that doesn't exist | Either write the missing memory or change the link wording |
| MEMORY.md line points to a deleted file | Remove the index line |

## Cross-project impact — easiest to miss

When working in one project, scan for these scenarios in OTHER projects:

- **Upstream API changed → downstream SDK docs**: protocol changes need both sides aligned
- **Shared subdomain / route / env var changed → every consumer's setup doc**
- **Auth backplane change → every integrating app's integration-guide**
- **Common library / infra version bump → every project's operator-guide / setup-guide mentioning the version**

Heuristic: did this change touch an SDK, subdomain, shared config, or cross-process protocol? If yes, grep every dependent project for docs mentioning it.

## Standard "new capability" four-edit pattern

Adding a new capability (API / flow / feature) almost always edits four places:

1. **integration-guide / external view** — how to use (curl / SDK example / error codes)
2. **architecture** — how it works (data flow, state machine, design tradeoffs)
3. **operator-guide** (formerly "runbook") — how to operate (smoke commands, troubleshooting, env vars)
4. **handoff / CHANGELOG** — what's done

API tables, env-var tables, glossaries are high-frequency structured lookups — must be always-current.

## Agent memory paths by platform

Different agents store cross-session knowledge in different places. Phase 1 inventory uses this table.

### Claude Code

| Purpose | Path |
|---|---|
| Cross-session memory (per project) | `~/.claude/projects/<encoded-project-path>/memory/` |
| Memory index | `~/.claude/projects/<...>/memory/MEMORY.md` |
| Global instructions | `~/.claude/CLAUDE.md` |
| Project instructions | Project root `CLAUDE.md` (nestable) |
| Skills directory | `~/.claude/skills/<name>/SKILL.md` |

Memory files use YAML frontmatter: `name`, `description`, `metadata.type` (one of `user` / `feedback` / `project` / `reference`). Body links to siblings via `[[name]]`. See main SKILL.md "Wayne auto-memory format" section.

### OpenAI Codex

| Purpose | Path |
|---|---|
| Cross-session instructions (global) | `~/.codex/AGENTS.md` or `$CODEX_HOME/AGENTS.md` |
| Project instructions | Project root `AGENTS.md` (nestable) |
| Project override | `AGENTS.override.md` (overrides same-dir AGENTS.md) |
| Skills directory | `~/.codex/skills/<name>/SKILL.md` or `.codex/skills/<name>/` |

Codex has no separate memory + index split — cross-session info lives in `AGENTS.md`. Sync writes "project facts" directly to AGENTS.md.

Also check for `TEAM_GUIDE.md` or `.agents.md` — Codex fallback names.

### OpenCode

| Purpose | Path |
|---|---|
| Global config | `~/.config/opencode/` |
| Project config | `.opencode/` |
| Skills (project) | `.opencode/skills/`, `.claude/skills/`, `.codex/skills/` are all scanned |
| Skills (global) | `~/.config/opencode/skills/`, `~/.claude/skills/`, `~/.codex/skills/` |

OpenCode reads both Claude Code and Codex skill directories — installing under `~/.claude/skills/` covers all three.

### Agent has no memory system

Skip the memory layer. Spend everything on:
- Project root markdown (CLAUDE.md / AGENTS.md / equivalent)
- README.md
- docs/

Memory is bonus; docs are the floor.

### Multi-agent project coexistence

If a project is used by both Claude Code and Codex users:
- Put both `CLAUDE.md` and `AGENTS.md` at the project root — symlink or maintain both
- OR one main file + the other a one-line `See CLAUDE.md` pointer
- docs/ and README are platform-neutral — single copy
