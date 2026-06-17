---
name: <kebab-name>
description: |
  <one dense paragraph: what judgment / lens / technique this skill encodes and
  when to reach for it. A lens skill is "capability uplift" — it reproduces a way
  of THINKING that plain prompting won't, NOT a fixed sequence of steps.>
  Triggers: <recurring phrases mined from the evidence sessions — the actual
  words used when re-running this by hand, BILINGUAL (中文 + English)>.
---

# Wayne <Title>

> <ONE line: a Chinese aphorism in this blockquote, OR an English contrast vs a
> sister skill. Never a paragraph.>

<one-line statement of what judgment this lens reproduces / what it lets the
reader decide that they couldn't reliably decide before.>

## Inherits from ~/.claude/CLAUDE.md

Inherits the Wayne control-plane invariants; does NOT redeclare them
(Language / Engineering Principles / Code Standards / Behavior / proportional
effort). This skill only specifies <the lens / judgment> below.

## Boundary vs neighbors

<Name the closest sibling skill(s) and the one line that keeps THIS skill
separate. A lens defines itself by the DECISIONS it owns, not the steps it runs.>

| Skill | Owns (the judgment) | Does NOT |
|---|---|---|
| **<kebab-name>** | <the call it makes> | <what it leaves to neighbors> |
| <closest neighbor> | <its judgment> | <…> |

## When this lens applies — and when it doesn't

- **Apply when:** <the contexts where this judgment pays off>.
- **Does NOT apply when:** <the red-line cases — a high-freedom skill that never
  says "no" is a vague essay. Name where the lens is the wrong tool>.

## Principles (Explain-the-Why)

<The core of a lens skill. State each rule, then WHY — the why becomes the rubric
for cases this skill never spelled out. "Use X. Y breaks Z because …" beats
"ALWAYS use X, NEVER use Y." The reasoning is what lets the reader generalize.>

### <Principle 1 — short imperative title>

- **Rule:** <the call>.
- **Why:** <the reason — this is the rubric for unanticipated cases>.

### <Principle 2 — …>

- **Rule:** <…>.
- **Why:** <…>.

<Repeat. If the principle set is large / multi-domain, move the full corpus to
`references/<lens>.md` and keep the headline rules + why here, with a pointer.>

## Worked examples (reasoning chains, NOT output samples)

<REQUIRED for a lens skill — ≥2. Show the JUDGMENT in motion: a real input, the
principles fired against it, the reasoning, the call. These act as few-shot
prompts — they teach the lens better than any prose. Pick examples that land on
DIFFERENT principles, ideally including one where the lens says "does not apply".>

### Example A — <input in one line>

- **Situation:** <the case>.
- **Lens applied:** <which principles fire, and the reasoning chain>.
- **Call:** <the verdict the lens produces>.

### Example B — <a contrasting input, different principle / a "no" case>

- **Situation:** <…>.
- **Lens applied:** <…>.
- **Call:** <…>.

## Anti-patterns

<For a lens, anti-patterns are MISAPPLICATIONS — applying the judgment where it
doesn't fit, or cargo-culting a rule without its why. Not "skipped a step".>

- <misapplying the lens out of its scope>
- <citing a rule while ignoring the why it generalizes from>
