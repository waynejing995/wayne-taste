# Anti-Slop Defaults

Bias corrections for known LLM design defaults. Every rule here yields to an
existing design system and to explicit user instruction (Authority Hierarchy).
These are reach-past-the-default rules, not a lexical checklist — judge intent,
do not grep the output.

**Contents**

- 1. Typography
- 2. Color
- 3. Shape & materiality
- 4. Layout diversification (Marketing surfaces)
- 5. Application & Operations surfaces
- 6. Content & imagery
- 7. Motion
- 8. Responsive & grid mechanics

---

## 1. Typography

- Display default `tracking-tighter leading-none` at a scale planned **together
  with** the hero asset size. A 4-line hero headline is a font-size error.
- Body default `leading-relaxed max-w-[65ch]`.
- Discouraged as default sans: `Inter`, `Roboto`, `Arial`, `Space Grotesk`.
  Reach for `Geist`, `Outfit`, `Cabinet Grotesk`, `Satoshi`, `PP Neue Montreal`,
  or a brand-appropriate face first. Inter is fine when the brief explicitly
  asks for neutral/standard/Linear-like, or for public-sector / a11y-first work.
- **Serif discipline.** "It feels creative/premium" is not a reason. Serif as
  display default is only acceptable when the brand brief names a serif, or the
  family is genuinely editorial / luxury / publication / heritage **and** you can
  say why this serif fits this brand. `Fraunces` and `Instrument Serif` are
  banned as defaults — they are the two LLM-favorite tells.
- If a serif is justified, rotate: PP Editorial New, GT Sectra Display, Reckless
  Neue, Tiempos Headline, Recoleta, EB Garamond, Domaine Display, Canela.
- **Emphasis in a headline uses italic or bold of the same family.** Injecting a
  serif word into a sans headline is amateur.
- Italic display words containing `y g j p q` need `leading-[1.1]` minimum plus
  `pb-1` reserve, or the descender clips.

## 2. Color

- One accent. Saturation under ~80% by default.
- **No AI-purple.** No automatic violet/blue button glows, no default neon
  gradients. Neutral base (zinc / slate / stone) + one high-contrast accent.
  If the brand asks for purple, use it deliberately with a harmonised palette.
- **Accent lock.** Once chosen, the accent is used on the whole page/app. A
  warm-grey product does not get a blue CTA in one section.
- **One neutral temperature per project.** Do not drift between warm and cool grays.
- **Premium-consumer palette ban.** For cookware / wellness / artisan / luxury /
  DTC-home briefs the LLM default is warm beige-cream backgrounds
  (`#f5f1ea`, `#faf7f1`, `#efeae0`), brass/clay/oxblood accents (`#b08947`,
  `#b6553a`, `#9a2436`), espresso near-black text (`#1a1714`). Banned as the
  default reach — every such site ends up identical. Rotate instead:
  cold luxury (silver/chrome/smoke), forest (deep green + bone + amber),
  black-and-tan, cobalt + cream, terracotta + slate, olive + brick + paper,
  or monochrome + one saturated pop. Do not ship the same family twice in a row.
  Acceptable only when the brand brief names those colors.
- Use `oklch()` to extend a palette harmonically when the given one is too thin.

## 3. Shape & materiality

- **Radius lock.** One corner-radius system per product: all-sharp, all-soft
  (12-16px), or all-pill for interactive. A mixed system needs a stated rule
  ("buttons pill, cards 16, inputs 8") followed everywhere.
- Cards only when elevation communicates real hierarchy or the card *is* the
  interaction. Otherwise group with `border-t`, `divide-y`, or space.
- Tint shadows to the background hue. No pure-black shadow on light ground.
- **Theme lock.** One theme per page/app. Sections do not invert. A single
  deliberate full theme switch is allowed once, only when the brief asks for it.

## 4. Layout diversification (Marketing surfaces)

- Centered hero is avoided when `DESIGN_VARIANCE > 4`. Prefer asymmetric split,
  left-content / right-asset, or scroll-pinned structures. Centered is fine for
  manifesto / launch-announcement briefs where the message is the design.
- **Hero fits the first viewport.** Headline ≤ 2 lines, subtext ≤ 20 words and
  ≤ 4 lines, CTAs visible without scrolling. Hero top padding ≤ `pt-24` desktop.
- **Hero stack ≤ 4 text elements**: (eyebrow OR brand strip OR neither),
  headline, subtext, CTAs (1 primary + at most 1 secondary). Trust micro-strips,
  pricing teasers, feature bullets, logo walls, avatar rows all move below.
- **Eyebrow restraint.** The small uppercase wide-tracking label above every
  section headline is the most common AI rhythm tell. At most one per three
  sections. Usually the headline alone is enough.
- **Split-header ban.** "Big headline left + small explainer paragraph right" as
  a section header is a default tell. Stack vertically unless the right column
  carries a real visual or interactive element.
- **Layout family repetition.** A layout family appears at most once per page.
  Eight sections need at least four families. Max 2 consecutive image+text
  zigzag splits; a third is a fail.
- **Bento cells equal content count.** 5 items → 5 cells. No blank filler tile.
  At least 2-3 cells need real visual variation (image, pattern, tinted ground),
  not six white-on-white text cards.
- Nav renders on one line at desktop, height ≤ 80px.
- At most one marquee per page.
- Declare the `< 768px` collapse explicitly per multi-column section.

## 5. Application & Operations surfaces

Marketing composition rules above do not transfer. For `Application` /
`Operations`:

- The primary task is reachable without hunting. Rank by workflow frequency,
  not by visual appeal.
- **Full state cycle is mandatory, not a stretch goal**: loading (skeleton
  matching the final shape, not a spinner), empty (composed, says how to
  populate), error (inline for forms, contextual for transient), partial /
  stale / permission-denied where the data model allows them.
- Form conventions: label above input, helper text present in markup, error
  below input. Never placeholder-as-label.
- Contrast is a hard gate: CTA text against its own background, form inputs,
  placeholders, focus rings, helper and error text all pass WCAG AA. Ghost
  buttons over imagery need a scrim or stroke.
- CTA labels fit one line at desktop; ≤ 3 words for primary actions.
- One label per intent across the whole product. "Get started" + "Try free" +
  "Sign up" on the same surface is a defect.
- Density comes from the dial, not from cramming. At `VISUAL_DENSITY > 7`,
  drop card chrome and let rows breathe with dividers.
- Prefer a real design system with mature data patterns over hand-rolled tokens
  (see `design-systems.md`).

## 6. Content & imagery

- **Real images.** Generate with an available image tool first; otherwise use a
  real photography source with a descriptive seed; otherwise leave labeled
  placeholder slots and tell the user what is needed. Never fill a page with
  hand-rolled decorative SVG or div-based fake screenshots/dashboards/terminals.
- Even a restrained editorial page needs 2-3 real images. Pure text is not
  minimalism, it is incomplete.
- Logo walls use real SVG marks (Simple Icons CDN, devicon) or a generated
  monogram for invented brands — not styled text wordmarks. Logos only; no
  category labels underneath.
- Icons come from one library per project (Phosphor / HugeIcons / Radix /
  Tabler), one global `strokeWidth`. Never hand-draw icon paths.
- Emoji only when the existing system uses them or the brief asks for a
  playful/social register.
- Long lists (> 5 items) need a different component, not a longer list: grouped
  2-column, card grid, tabs/accordion, scroll-snap pills, marquee. A 10-row
  spec table with a hairline under every row is the worst default.
- **Copy self-audit before shipping.** Re-read every visible string. Cut
  anything grammatically broken, with unclear referents, forced-cute wordplay,
  or mock-poetic meta. Plain functional copy beats clever AI copy.
- Fake-precise numbers (`92%`, `4.1×`, `5.8 mm`) must come from real data or be
  labeled as mock. Do not fabricate engineering precision.
- Quotes ≤ 3 lines, attribution is name + role (+ company). Never name only.
- One copy register per product.

## 7. Motion

- **Every animation states what it communicates**: hierarchy, storytelling,
  feedback, or state transition. "It looked cool" is not an answer — drop it.
- Animate `transform` and `opacity` only. Never `top` / `left` / `width` / `height`.
- Never `window.addEventListener("scroll")` or `window.scrollY` in React state.
  Use `useScroll` / motion values, ScrollTrigger, IntersectionObserver, or CSS
  `animation-timeline: view()`.
- Never drive continuous pointer/scroll values through `useState` — motion
  values only, outside the render cycle.
- `useEffect` animations need strict cleanup. GSAP work uses `gsap.context()`
  with `ctx.revert()`.
- Sticky-stack and horizontal-pan need `start: "top top"` and `pin: true`;
  triggering at `top center` shows a half-pinned section.
- Grain/noise overlays go on a fixed `pointer-events-none` layer only, never on
  a scrolling container.
- `min-h-[100dvh]`, never `h-screen`, for full-height sections.

## 8. Responsive & grid mechanics

- Multi-column layouts collapse to single column below 768px, declared in the
  same component. No "Tailwind will handle it" assumptions.
- Horizontal overflow on mobile is a critical failure. Wrap the page root in
  `overflow-x-hidden w-full max-w-full` when off-screen animations are in play.
- Headlines scale with `clamp()`. Body text never below 16px (14px absolute
  floor for dense operations tables).
- Interactive targets are at least 44px on touch.
- Bento and feature grids use `grid-auto-flow: dense` and interlocking
  col/row spans. Verify no empty cell survives at any breakpoint.
- Asymmetric desktop layouts drop their rotations and negative-margin overlaps
  below 768px — overlaps create touch-target conflicts.
- Vertical section rhythm scales too: `clamp(3rem, 8vw, 6rem)`, not a fixed
  desktop value shipped to phones.
- Align shared elements across side-by-side cards (title, body, price, CTA).
  Pin CTAs to the card bottom so they form one line regardless of content above.
