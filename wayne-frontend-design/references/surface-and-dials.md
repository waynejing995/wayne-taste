# Surface Topology & Dials

Read after Layer 0 context detection, before writing the Design Read.

## 1. Surface topology

Classify the surface before choosing any aesthetic. The surface decides which
composition rules apply — most published design references (including
awesome-design-md) describe **marketing surfaces only**.

| Surface | Signals | Composition priority | awesome-design-md |
|---|---|---|---|
| `Marketing` | landing page, portfolio, brand site, launch/announcement page, pricing page, editorial/blog | First viewport is a poster. Narrative order, one visual anchor, ruthless copy cuts. | Applies — use as tonal comparison |
| `Application` | authenticated product UI, multi-step flows, editors, forms, settings, wizards | Workflow hierarchy first. Primary task reachable in one move. Full state cycle (loading / empty / error / partial) is required, not optional. | Does NOT apply — brand DESIGN.md files carry no app patterns |
| `Operations` | dashboards, data tables, monitoring, admin consoles, log/trace views | Information density and scan speed. Real design system with mature data patterns beats hand-rolled tokens. | Does NOT apply |
| `Component` | one component inside an existing tree | Host system owns everything. Match its tokens, spacing, states, a11y contract. | Does NOT apply |

Mixed products (marketing site + app) get one classification **per route**, not
one for the repo.

## 2. Dials

After the surface and Design Read, set three values. They gate every layout,
motion, and density decision downstream. State them explicitly; never leave them
implicit or "default".

- `DESIGN_VARIANCE` 1-10 — 1 = perfect symmetry, 10 = artsy asymmetry
- `MOTION_INTENSITY` 1-10 — 1 = static, 10 = cinematic / physics
- `VISUAL_DENSITY` 1-10 — 1 = art gallery, 10 = cockpit

### 2.A Inference from the brief

| Brief signal | VARIANCE | MOTION | DENSITY |
|---|---|---|---|
| minimalist / calm / editorial / "Linear-style" | 5-6 | 3-4 | 2-3 |
| premium consumer / luxury / brand | 7-8 | 5-7 | 3-4 |
| playful / experimental / agency / Awwwards | 9-10 | 8-10 | 3-4 |
| landing / portfolio / marketing (unqualified) | 7-9 | 6-8 | 3-5 |
| trust-first / public-sector / regulated / a11y-critical | 3-4 | 2-3 | 4-5 |
| internal tool / back-office app | 3-4 | 2-3 | 6-7 |
| clinical / safety-critical / field operations | 2-3 | 1-2 | 5-7 |
| consumer app (mobile-first, task-driven) | 5-6 | 5-6 | 4-5 |
| creative/authoring tool (editor, canvas, IDE-like) | 4-5 | 3-5 | 6-8 |
| monitoring / observability dashboard | 2-3 | 1-3 | 8-9 |
| data table / admin console | 2-3 | 1-2 | 7-9 |
| redesign — preserve | match existing | +1 | match existing |
| redesign — overhaul | +2 | +2 | match existing |

Existing design system detected → dials describe only what you add; they never
override the host system.

### 2.B What the dials mean concretely

**DESIGN_VARIANCE**
- 1-3: symmetric grid, equal padding, centered alignment, predictable rhythm
- 4-7: offsets, negative-margin overlaps, mixed aspect ratios, left-aligned headers over centered data
- 8-10: masonry, fractional grid columns (`2fr 1fr 1fr`), large deliberate empty zones

**MOTION_INTENSITY**
- 1-3: state changes only, no entrance animation
- 4-6: one entrance, one scroll reveal, one hover response
- 7-10: scroll-driven sequences, pinned sections, pointer physics

Motion claimed is motion shipped. If `MOTION_INTENSITY > 4` the page must
actually move. If you cannot ship working motion in scope, drop the dial to 3
and ship clean static — never half-built motion with broken triggers.

Any motion above 3 must honor `prefers-reduced-motion` and collapse to static.

**VISUAL_DENSITY**
- 1-3: one idea per viewport, generous whitespace
- 4-6: grouped content blocks, comfortable table rows
- 7-10: compact rows, tight leading, multi-pane layout; generic card containers
  are banned at this level — data breathes in plain layout with dividers

## 3. Design Read (one line, before any code)

> Reading this as: `<surface>` — `<page/product kind>` for `<audience>`, primary
> task `<task>`, `<vibe>` language, leaning toward `<design system or aesthetic
> family>`. Dials `V/M/D`.

Examples:
- *Application — clinical shift-handover tool for ward nurses, primary task "hand off 12 patients in 4 minutes", high-contrast utilitarian language, leaning toward Radix Themes + system-native density. Dials 3/2/7.*
- *Marketing — B2B SaaS landing for technical buyers, primary task "book a demo", restrained minimalist language, leaning toward Tailwind + Geist. Dials 6/4/3.*
- *Operations — fleet monitoring console for on-call engineers, primary task "spot the failing node in 5 seconds", dense neutral language, leaning toward Carbon. Dials 2/1/9.*

If the read genuinely diverges, ask **one** question. If you can infer
confidently, do not ask — declare the read and proceed to the Layer 1 checkpoint.
