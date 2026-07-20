---
name: wayne-frontend-design
description: Wayne-style UI/UX design skill. Combines Anthropic Claude Design system prompt principles, compound-engineering frontend-design workflow, and VoltAgent awesome-design-md DESIGN.md system. Use for any frontend/UI work — landing pages, web apps, dashboards, components, prototypes, slides. Detects existing design systems and respects them. Bilingual ops (Chinese to user, English in files). Trigger on "design this", "build UI", "make a landing page", "frontend work", "wayne design".
---

# Wayne Frontend Design

Distinctive, production-grade UI work — not AI slop. Detects context, plans visual thesis, builds with intention, verifies visually. Bilingual operations matching Wayne convention.

## Files Written

HTML, CSS, JS, JSX, design tokens, comments, DESIGN.md. Severity tags `[CRITICAL]` / `[OVERRIDE]`, mode names (`Existing` / `Partial` / `Greenfield`), file:line references stay English in Chinese prose.

## Authority Hierarchy

Every rule below is a default, not a mandate.

1. **Existing design system / codebase patterns** — highest priority, always respected
2. **User's explicit instructions** — override skill defaults
3. **Skill defaults** — apply in greenfield work or when user asks for guidance

When working in an existing codebase, follow what exists. When user contradicts a default, follow the user.

## MANDATORY Pre-Work Reading

Per Wayne global rule (`~/.claude/CLAUDE.md` — Frontend section), this is **non-negotiable**:

Before ANY UI work, you MUST:

1. Fetch `https://raw.githubusercontent.com/VoltAgent/awesome-design-md/main/README.md` via WebFetch
2. Skim the listed brand DESIGN.md entries to find a tonal/aesthetic anchor closest to the user's intent
3. If user already has a brand, fetch the matching `DESIGN.md` raw file from the repo as a reference

Skip this step ONLY when:
- User explicitly says "skip awesome-design read"
- An existing project DESIGN.md is already present (use it instead)

## Reference Files

Local references in this skill folder:

- `references/claude-design-sys-prompt.txt` — Anthropic Claude Design (Opus 4.7) leaked system prompt. Source of truth for: workflow, output naming, asset copying, React+Babel pinning rules, color/emoji policy, "make playback position persistent" UX patterns.

- `references/agent-browser/` — full local copy of `compound-engineering:agent-browser` skill (SKILL.md + 7 reference docs + 3 shell templates). Use as the canonical guide for visual verification: launching the headless browser, taking screenshots, capturing video, authenticated sessions, profiling.

Read references when uncertain — output conventions in `claude-design-sys-prompt.txt`, browser commands in `agent-browser/`.

## Checklist

You MUST create a TodoWrite task per item and complete in order:

1. **Read awesome-design-md README** — find aesthetic anchor or matching brand DESIGN.md
2. **Detect context (Layer 0)** — scan for design tokens, component libs, frameworks
3. **Classify mode** — Existing / Partial / Greenfield / Ambiguous
4. **Pre-build plan (Layer 1)** — write Visual Thesis + Content Plan + Interaction Plan in Chinese
5. **User checkpoint** — present plan, wait for approval before code
6. **Build** — implement matching the plan and detected system
7. **Visual verify** — screenshot via best available tool, one pass
8. **Self-review against Litmus checks**
9. **Summarize EXTREMELY BRIEFLY** — caveats and next steps only

## Process Flow

```
[Read awesome-design-md] -> [Layer 0: Context Detection] -> [Mode classification]
        |                                                          |
        v                                                          v
[Layer 1: Visual Thesis + Content + Interaction plan] <----- [Existing? defer to it]
        |
        v
[Chinese checkpoint to user] --(approved)--> [Build] --> [Visual verify] --> [Litmus] --> [Brief summary]
```

---

## Layer 0: Context Detection

Use Glob/Grep (NOT shell) to scan for:

- **Design tokens / CSS variables**: `--color-*`, `--spacing-*`, theme files
- **Component libraries**: shadcn/ui, MUI, Chakra, Ant, Radix, project-specific
- **CSS frameworks**: `tailwind.config.*`, styled-components theme, CSS modules
- **Typography**: `@font-face`, Google Fonts links, font imports
- **Color palette**: Defined scales, brand color files, token exports
- **Animation libraries**: Framer Motion, GSAP, anime.js, Motion One
- **Project DESIGN.md**: existing design system spec at repo root or `docs/`

### Mode Classification

| Mode | Signals | Behavior |
|------|---------|----------|
| `Existing` | 4+ across categories OR `DESIGN.md` present | Defer fully. Skill aesthetic opinions yield. Structural guidance still applies. |
| `Partial` | 1-3 signals | Follow what exists; apply skill defaults only for uncovered areas |
| `Greenfield` | 0 signals | Full skill guidance + awesome-design-md anchor |
| `Ambiguous` | Contradictory signals | Use AskUserQuestion (Chinese) before proceeding |

---

## Layer 1: Pre-Build Plan (REQUIRED)

Write three short statements in Chinese to the user before any code. This is your checkpoint.

1. **Visual Thesis (视觉主张)** — one sentence: mood + material + energy
   - Greenfield: "干净的编辑风，大面积留白，衬线标题，沉静的大地色系"
   - Existing: describe current aesthetic + how new work extends it

2. **Content Plan (内容布局)** — what goes where, in what order
   - Landing: hero / support / detail / CTA
   - App: workspace / nav / inspector
   - Component: states + what it communicates

3. **Interaction Plan (交互动效)** — 2-3 specific motion ideas
   - Not "加动画" but "hero 加载分阶段淡入，section 间滚动视差，卡片 hover 轻微 scale-up"
   - In existing codebase: describe ONLY what's added, using existing motion lib

After presenting, wait for approval (use AskUserQuestion in Chinese).

---

## Layer 2: Design Guidance Core

All defaults yield to existing system + user instructions per Authority Hierarchy.

### Typography
- Distinctive, characterful fonts. AVOID: Inter, Roboto, Arial, system defaults (in greenfield)
- Two typefaces max without reason. Display + body pairing
- Yields to existing fonts when detected

### Color & Theme
- Cohesive palette via CSS variables. Dominant color + sharp accents > timid even palette
- No purple-on-white default. No dark-mode default. Vary by context
- Use `oklch()` for harmonious extensions when palette is too restrictive
- One accent unless product is multi-color
- Yields to existing tokens

### Composition
- Composition first, components later. First viewport = poster, not document
- Whitespace, alignment, scale, cropping, contrast BEFORE chrome (borders, shadows, cards)
- Cardless by default. Cards only when card IS the interaction (clickable / draggable / selectable)
- If removing card styling does not hurt comprehension, it is not a card

### Motion
- Ship 2-3 intentional motions: one entrance, one scroll/depth, one hover/reveal
- Use existing animation lib if present. Otherwise framework-conditional:
  - CSS animations — universal baseline
  - Framer Motion — React
  - Vue Transition / Motion One — Vue
  - Svelte transitions — Svelte
- Smooth on mobile. Remove if purely ornamental

### Accessibility
- Semantic HTML: `nav`, `main`, `section`, `article`, `button` — not divs for everything
- WCAG AA contrast minimum
- Focus states on ALL interactive elements

### Imagery
- Real or realistic photography > abstract gradients > fake 3D
- Stable tonal area for text overlay
- Prefer brand assets when DESIGN.md provides them

---

## Output Conventions

Inherited from Claude Design system prompt (`references/claude-design-sys-prompt.txt`):

- **Filenames**: descriptive PascalCase or Title Case — `Landing Page.html`, `Dashboard.html`
- **Revisions**: copy + edit, preserve old (`My Design.html`, `My Design v2.html`) when significant
- **Files >1000 lines**: SPLIT into smaller JSX files, import into main
- **React + Babel inline JSX**: ALWAYS use pinned versions with integrity hashes (see reference file)
- **Style objects**: NEVER use `const styles = {...}` — name them `terminalStyles`, `heroStyles` to avoid collision when multiple components share scope
- **Asset handling**: copy needed assets from design systems; do NOT bulk-copy >20 files
- **Persistent state**: for decks/videos/iterables, store playback position in `localStorage`
- **scrollIntoView**: NEVER use it — use other DOM scroll methods
- **Emoji**: only if existing design system uses them

---

## Hard Rules

### Default Against (Overridable)

- Generic SaaS card grid as first impression
- Purple-on-white, dark-mode bias by default
- Overused fonts (Inter, Roboto, Arial, Space Grotesk) in greenfield
- Hero cluttered with stats, schedules, pill clusters, logo clouds
- Sections repeating the same mood statement in different words
- Carousel with no narrative purpose
- Multiple competing accent colors
- Decorative gradients standing in for real visual content
- Copy that sounds like design commentary ("Experience seamless integration")
- Split-screen heroes with text on busy side of image

### Always Avoid (Quality Floor)

- Prompt language or AI commentary leaking into UI
- Broken contrast (text unreadable over images/backgrounds)
- Interactive elements without visible focus states
- Semantic div soup when proper HTML elements exist
- Inventing colors from scratch when a palette exists

---

## Litmus Checks (Self-Review)

Before visual verification — apply judgment about which apply:

- Brand/product unmistakable in the first screen?
- One strong visual anchor?
- Page understandable by scanning headlines only?
- Each section has one job?
- Cards actually necessary where used?
- Motion improves hierarchy/atmosphere, or just there?
- Premium feel if all decorative shadows removed?
- Copy sounds like the product, not like a prompt?
- New work matches existing design system? (Existing/Partial mode)

---

## Visual Verification

One pass. Sanity check, not pixel-perfect review.

### Tool

Use **`compound-engineering:agent-browser`** directly. No cascade, no fallback chain.

- Local copy at `references/agent-browser/SKILL.md` — read first if unfamiliar
- Detail docs: `references/agent-browser/references/{commands,session-management,snapshot-refs,video-recording,authentication,profiling,proxy-support}.md`
- Shell templates: `references/agent-browser/templates/{capture-workflow,authenticated-session,form-automation}.sh`
- Take a screenshot of the rendered output, compare to Visual Thesis from Layer 1
- If headless CI / cannot install → mental review against Litmus checks, note that visual verification was skipped

### What to Assess

- Output matches Visual Thesis from Layer 1?
- Obvious visual problems (broken layout, unreadable text, missing images)?
- Looks like the intended module (landing feels like landing, dashboard like dashboard)?

For multi-round refinement, defer to `compound-engineering:design:design-iterator`.

---

## Final Summary

EXTREMELY BRIEF. In Chinese. Caveats + next steps only. Do NOT restate what you built — the user can see the diff.

---

## Lineage

- **Anthropic Claude Design** (Opus 4.7) leaked system prompt — workflow, output conventions, React+Babel rules. See `references/claude-design-sys-prompt.txt`
- **compound-engineering:frontend-design** — Authority Hierarchy, Layer 0/1/2, Litmus, Module classification
- **VoltAgent awesome-design-md** — DESIGN.md catalog as aesthetic anchor source
- **Wayne global rules** (`~/.claude/CLAUDE.md`) — bilingual operation, awesome-design read mandate, KISS/DRY/YAGNI
- **compound-engineering:agent-browser** — sole visual verification tool
