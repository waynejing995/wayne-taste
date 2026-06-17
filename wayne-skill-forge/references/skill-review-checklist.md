# Skill review checklist

The deep review. Run it on a freshly-forged skill before the user gate, OR
standalone on any existing `SKILL.md` the user asks you to check. Distilled from
Anthropic's `skill-reviewer` agent + `skill-development` skill (the format
authority) and layered with Wayne house-style + voice checks.

Tag every finding **critical** (blocks ship) / **major** (fix before merge) /
**minor** (nice-to-have). Report by severity, not by file order.

## Table of contents

1. Structure & frontmatter
2. Description (the trigger) — most critical
3. Content quality & sizing
4. Progressive disclosure & resources
5. Wayne house style + voice
6. Anti-duplication & SSoT
7. Output format

---

## 1. Structure & frontmatter

- **critical** — `SKILL.md` exists; YAML frontmatter is valid (between `---`).
- **critical** — frontmatter has `name` + `description`, nothing speculative.
- **critical** — `name` is kebab-case AND equals the directory name.
- **major** — referenced files (`references/`, `scripts/`, `templates/`,
  `assets/`) actually exist on disk. Broken pointers = report with the path.
- **minor** — no deprecated fields (`when_to_use` is dead; put it in description).

## 2. Description (the trigger) — most critical

The description is the PRIMARY mechanism that decides whether the skill fires.

- **critical** — carries ALL the "when to use"; none hidden in the body.
- **major** — includes specific trigger *phrases* a real user would type, not a
  vague summary. Wayne: bilingual (中文 + English), mined from real evidence.
- **major** — slightly pushy against undertriggering (Anthropic: Claude tends to
  under-fire skills). State the non-obvious contexts explicitly.
- **minor** — length sane: not <50 chars, not a wall; ~1024 chars is the ceiling.
- **minor** — third-person / imperative framing ("…used when the user asks to X"),
  not "Load this when you…".

## 3. Content quality & sizing

- **critical** — body < 5k words / < 500 lines (hard ceiling). Over → split.
- **major** — body lean: 1,500–2,000 words ideal, <3,000 good. Trim anything not
  pulling its weight.
- **major** — imperative / infinitive voice ("To do X, do Y"), not second person.
- **minor** — concrete guidance over vague advice; every step has a verify check;
  human gates marked explicitly.

## 4. Progressive disclosure & resources

- **major** — detail that isn't the always-loaded core lives in `references/`,
  not inline (schemas, API docs, edge cases, long checklists, domain variants).
- **major** — `scripts/` exists for any code the skill would otherwise rewrite
  every run, or that needs deterministic reliability. Script is executable +
  documented + (if it must run anywhere) stdlib-only.
- **minor** — `references/` file > 300 lines has a TOC; > 10k words → SKILL.md
  gives grep patterns into it.
- **minor** — `assets/` / `templates/` used for files that go INTO the output,
  not for docs.
- **major** — SKILL.md actually *points* to every resource it ships (an
  unreferenced reference file is invisible to the model).

## 5. Wayne house style + voice

(See `waynejing` §表达 DNA + §输出格式硬约束 — the voice SSoT.)

- **critical** — the 5 always-required elements present: frontmatter+triggers,
  positioning epigraph, Inherits block, Boundary table, Anti-patterns. Plus the
  archetype's 6th: **procedure** → `Process`-with-verify (+Flow if branching);
  **lens** → `Principles` in Explain-the-Why form + applicability boundary + ≥2
  worked examples.
- **major** — archetype fit: a judgment skill isn't forced into a fake `→ verify:`
  Process; a fragile procedure isn't left as a vague lens. Anti-patterns match the
  archetype (corrected *mistakes* for procedure; *misapplications* for lens).
- **major** — lens only: every principle states a *why* (the generalization
  rubric); worked examples are *reasoning chains*, not output samples.
- **major** — Boundary table names the closest sibling skill(s); a reader can
  tell this skill from each neighbor by Input/Output.
- **major** — voice gate: scan every `- ` / `1. ` line — any >120 chars (CJK) or
  ≥2 sentence-stops → split into title-bullet + sub-bullets, a table, or a
  `####` subsection.
- **major** — no 禁忌词: 客服开场 / 鸡汤结尾 / 网络称谓 / 商业黑话
  (全方位·赋能·抓手) / 削弱词三连 (其实·不过·嗯).
- **minor** — HARD-GATE reserved for the load-bearing gates (user-approval,
  self-check); explain the *why* elsewhere rather than caps-MUST every line.
- **minor** — Flow dotgraph (if present): braces balance, shapes correct
  (box/diamond/doublecircle), every diamond has yes+no edges.

## 6. Anti-duplication & SSoT

- **critical** — no fact stored in two places (body AND a reference, or copied
  from another skill). One owner. This is the bug class Wayne cares about most.
- **major** — doesn't re-derive what a sibling owns (voice → `waynejing`; format
  floor → Anthropic `skill-creator`). Cite, don't copy.
- **major** — net value: the skill earns its file against its closest sibling
  (Delete>Add). If it mostly overlaps, it should have been an *Extend*.

## 7. Output format

Report like the `skill-reviewer` agent:

```
## Skill Review: <name>
### Summary            — overall + word/line counts
### Description        — current / issues / suggested rewrite
### Content & sizing   — counts + assessment
### Progressive disclosure — structure + is it effective?
### Findings by severity   — Critical (n) / Major (n) / Minor (n), each: location → fix
### Positive aspects
### Verdict            — Pass / Needs improvement / Needs major revision
```
