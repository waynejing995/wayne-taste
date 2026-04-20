---
name: wayne-compound
description: Capture lessons learned after solving a problem or shipping a feature. Reads the full Wayne pipeline artifacts (decision log, plan, review findings) and distills into searchable KB entries and in-repo solution docs. Auto-triggers on "that worked", "it's fixed", "problem solved", or explicitly via "/wayne-compound". Use after shipping or fixing something non-trivial.
---

# Wayne Compound

Each solved problem should make the next one easier.
This skill captures what was learned and saves it where it can be found later.

## Language Rules

**Chinese (output to user):** ALL communication shown to the user — questions, explanations,
summaries, insight presentations, status reports. This includes AskUserQuestion text
and any prose the user reads.

**English (written to files):** ALL files saved to disk — KB entries, solution docs,
decision log updates. No exceptions.

**English (structural labels):** Category names, frontmatter keys, section headers
stay English even in Chinese prose.

## When to Run

**Auto-trigger phrases:**
- "that worked", "it's fixed", "working now", "problem solved"
- After `wayne-ship` completes

**Manual:** `/wayne-compound` or `/wayne-compound [brief context]`

**Skip when:**
- Trivial fix (typo, obvious one-liner)
- No non-obvious insight was gained
- Problem was already documented

## Checklist

1. **Gather pipeline artifacts** — decision log, plan, review findings, commit messages
2. **Extract the learning** — what was the real insight?
3. **Classify** — bug fix, pattern, decision, how-to?
4. **Check for duplicates** — MANDATORY before writing. Search KB and docs/solutions/ first. If anything similar exists, UPDATE it, do not create a new file. Specifically:
   - grep both the title AND the trigger keywords across `/mnt/share/wayne-note/`
   - check `how-to/lessons/` (imported lessons from prior projects)
   - check the current repo's `docs/solutions/`
   - if a hit shares the same root cause or trigger condition → update the existing file (bump `updated:`, append new evidence/refinement). Do not write a new lesson.
   - only write a new file when the topic is genuinely new
5. **Write to KB** — `/mnt/share/wayne-note/` (primary, Obsidian-compatible)
6. **Write to repo** — `docs/solutions/` (secondary, in-repo discovery)
7. **Cross-reference** — link between KB entry and repo doc

## Process Flow

```dot
digraph compound {
    rankdir=TB;

    "Gather pipeline artifacts\n(decision log, plan,\nreview, commits)" [shape=box];
    "Extract the real insight\n(not just what happened)" [shape=box];
    "Classify:\nbug / pattern / decision / how-to" [shape=box];
    "Search KB + docs/solutions/\nfor duplicates" [shape=box];
    "Duplicate found?" [shape=diamond];
    "Update existing entry" [shape=box];
    "Write new KB entry\n(/mnt/share/wayne-note/)" [shape=box];
    "Write repo doc\n(docs/solutions/)" [shape=box];
    "Cross-reference\nKB <-> repo doc" [shape=box];
    "Done" [shape=doublecircle];

    "Gather pipeline artifacts\n(decision log, plan,\nreview, commits)" -> "Extract the real insight\n(not just what happened)";
    "Extract the real insight\n(not just what happened)" -> "Classify:\nbug / pattern / decision / how-to";
    "Classify:\nbug / pattern / decision / how-to" -> "Search KB + docs/solutions/\nfor duplicates";
    "Search KB + docs/solutions/\nfor duplicates" -> "Duplicate found?";
    "Duplicate found?" -> "Update existing entry" [label="yes"];
    "Duplicate found?" -> "Write new KB entry\n(/mnt/share/wayne-note/)" [label="no"];
    "Update existing entry" -> "Done";
    "Write new KB entry\n(/mnt/share/wayne-note/)" -> "Write repo doc\n(docs/solutions/)";
    "Write repo doc\n(docs/solutions/)" -> "Cross-reference\nKB <-> repo doc";
    "Cross-reference\nKB <-> repo doc" -> "Done";
}
```

---

## Phase 1: Gather Pipeline Artifacts

Read all available Wayne pipeline outputs:

```bash
# Decision log from brainstorming
ls -t docs/decisions/*.md 2>/dev/null | head -3

# Plan from planning
ls -t docs/plans/*.md 2>/dev/null | head -3

# Specs from brainstorming
ls -t docs/specs/*.md 2>/dev/null | head -3

# Recent commits
git log --oneline -10

# Diff summary
git diff HEAD~5 --stat 2>/dev/null
```

For each artifact found, read it and extract:

| Source | What to extract |
|--------|----------------|
| **Decision log** | Key decisions, rationale, surprises, things that changed mid-process |
| **Plan** | Original approach vs what actually happened |
| **Review findings** | Issues caught by dual-voice review, contradictions between Claude/Codex |
| **Commit messages** | The [why] and [how] from each commit |
| **Conversation** | Investigation steps, dead ends, breakthroughs |

---

## Phase 2: Extract the Real Insight

The goal is NOT to document what happened. It's to document **what was learned**.

Ask yourself:
- What would have saved time if we'd known it before starting?
- What assumption turned out to be wrong?
- What pattern emerged that applies beyond this specific case?
- What was the non-obvious part of the solution?
- What dead end should future-us avoid?

Distill into:
- **One-line takeaway** — the insight in one sentence
- **Context** — when does this apply?
- **Detail** — the full explanation with code examples if relevant
- **Anti-pattern** — what NOT to do (if applicable)

---

## Phase 3: Classify

| Category | KB folder | docs/solutions/ folder | When to use |
|----------|-----------|----------------------|-------------|
| **Bug fix** | `how-to/` | `runtime-errors/` or specific category | Solved a bug with non-obvious root cause |
| **Pattern** | `research/` | `patterns/` | Discovered a reusable approach |
| **Decision** | `decisions/` | — (decision log suffices) | Made an architectural or design choice with rationale |
| **How-to** | `how-to/` | `integration-issues/` | Figured out how to do something that wasn't documented |
| **Pitfall** | `how-to/` | specific category | Found a trap that others will fall into |

---

## Phase 4: Check for Duplicates

Search both knowledge stores:

```bash
# Search KB
grep -r "<keywords>" /mnt/share/wayne-note/ --include="*.md" -l 2>/dev/null

# Search docs/solutions
grep -r "<keywords>" docs/solutions/ --include="*.md" -l 2>/dev/null
```

If a related entry exists:
- Read it
- Decide: **update** (same problem, better insight) or **new** (different angle)
- If updating, preserve the existing structure and add the new context

---

## Phase 5: Write to KB (as a Lesson)

**Primary store:** `/mnt/share/wayne-note/<folder>/<kebab-title>.md`

**Read `/mnt/share/wayne-note/SCHEMA.md` first** — it defines the Write Protocol and lesson
frontmatter spec. This phase defers to SCHEMA. Don't re-implement reindex /
log / commit logic here.

Compound writes a **lesson** — a regular KB page with two extra frontmatter
fields (`type: lesson` + `trigger`) so future workflow skills can recall it.

### Folder placement

| Category | Folder |
|----------|--------|
| Bug fix / pitfall | `wayne-note/how-to/<kebab-title>.md` |
| Reusable pattern | `wayne-note/research/<kebab-title>.md` |
| Architectural decision | `wayne-note/decisions/<kebab-title>.md` |

### Lesson format (per SCHEMA.md)

```markdown
---
title: <Descriptive title>
date: YYYY-MM-DD
tags: [tag1, tag2, tag3]
source: manual
pipeline: wayne          # captured from Wayne workflow
type: lesson             # ★ identifies this as a lesson (recallable)
trigger: "<one sentence: when this lesson should be recalled>"   # ★ recall hook
related: [[folder/related-entry]]
---

## Summary

<One-line takeaway — the insight in one sentence>

## Context

<When does this apply? What situation triggers this knowledge?>

## Detail

### What Happened
<Brief narrative of the problem and investigation>

### The Insight
<The non-obvious thing we learned>

### Code Examples
<Before/after, configuration, commands>

## Anti-Patterns

<What NOT to do, and why>

## Prevention

<How to avoid this in the future>

## References

- Decision log: [[decisions/YYYY-MM-DD-topic]]
- Plan: docs/plans/YYYY-MM-DD-NNN-type-name-plan.md
- Repo doc: docs/solutions/category/filename.md
```

### Writing a good `trigger`

This field is what `wayne-mind-explode` and `wayne-plan` use to recall the
lesson before related work starts. Write it as a future-tense scenario.

| Bad | Good |
|-----|------|
| `"asyncio bug"` | `"用 asyncio 配合 multiprocessing 时"` |
| `"SQLAlchemy issue"` | `"改 SQLAlchemy 查询性能或评估 N+1 风险时"` |
| `"CLI bug"` | `"给 Click CLI 加新 subcommand 或新 option 时"` |

Bad triggers describe the problem in past tense (useless for recall).
Good triggers describe the **scenario where the lesson applies** (matches
future user intent).

### Confirm `trigger` with the user (MANDATORY pause)

After drafting the lesson file but **before** running reindex / log / commit,
stop and show the user the proposed `trigger` field for confirmation:

> 这条 lesson 的 trigger 我写成：
> > "<draft trigger>"
>
> 这是未来 wayne-mind-explode / wayne-plan 召回这条 lesson 的关键。
> OK 直接用 / 改成 ... / 我来重写

Why this matters: `trigger` is the recall key. A bad trigger means future
workflow skills will miss this lesson when it's most relevant. The user knows
best what future scenarios should remind them of this. One short interaction
now saves countless missed recalls later.

Update the file in place if the user revises it, then proceed.

### Then follow the Write Protocol

After `trigger` is confirmed, follow `/mnt/share/wayne-note/SCHEMA.md` Write Protocol:
reindex → append log.md (action: `lesson`) → git commit → report files.

---

## Phase 6: Write to Repo

**Secondary store:** `docs/solutions/<category>/<filename>.md`

This is for in-repo discovery — agents working in this repo can find it without
accessing the personal KB.

```markdown
---
title: <Title>
date: YYYY-MM-DD
problem_type: <bug|pattern|pitfall|how-to>
module: <affected module>
tags: [tag1, tag2]
---

# <Title>

## Problem

<1-2 sentence description>

## Root Cause

<Technical explanation>

## Solution

<The fix, with code examples>

## Prevention

<How to avoid recurrence>

## Related

- KB: /mnt/share/wayne-note/<folder>/<filename>.md
```

Create directory if needed:
```bash
mkdir -p docs/solutions/<category>/
```

---

## Phase 7: Cross-Reference

Link the two entries:
- KB entry's `References` section → repo doc path
- Repo doc's `Related` section → KB entry path
- If a decision log exists, add a final row: `| compound | Learning captured | see KB + docs/solutions/ | — | — |`

---

## Integration with Wayne Workflow

```
wayne-mind-explode → wayne-plan → ce-work → wayne-code-review → wayne-ship → wayne-compound
     (WHAT)            (HOW)      (BUILD)       (GATE)           (COMMIT)     (LEARN)
```

This is the closing step. It reads everything upstream produced and distills
the non-obvious insights into searchable, reusable knowledge.

### What makes Wayne compound different from CE compound:

| Aspect | CE compound | Wayne compound |
|--------|-------------|----------------|
| **Primary store** | `docs/solutions/` only | `/mnt/share/wayne-note/` (Obsidian) + `docs/solutions/` |
| **Input** | Conversation history | Full pipeline: decision log + plan + review + commits |
| **Decision trace** | None | Links back to specific decisions in the log |
| **Specialized reviews** | Auto-dispatches domain experts | Skip (user can run manually) |
| **Auto-trigger** | "it's fixed" phrases | Same + after `wayne-ship` |

---

## Key Principles

- **Insight over narrative** — capture what was learned, not what happened
- **Two stores, cross-linked** — KB for personal recall, repo for team discovery
- **Duplicate-aware** — update existing entries, don't create duplicates
- **Pipeline-aware** — reads the full Wayne decision trail
- **Chinese for discussion, English for artifacts**
