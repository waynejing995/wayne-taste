# Aesthetic Families

The material library for the §C mock round. Pick 2-3 families that are genuinely **far apart** on the surface's plausible range, build one mock each, let the user choose. Three shades of the same family is a failed checkpoint.

Each family states: where it fits, type, color, surface treatment, motion. Three inputs combine — `layout-archetypes.md` sets the structure, a family here sets the material, and the dials in `surface-and-dials.md` set the intensity.

**Contents**

- Selection rule
- A. Utilitarian Editorial
- B. Soft Structuralism
- C. Ethereal Glass
- D. Swiss Industrial
- E. Console / Tactical Telemetry
- F. Neutral System
- G. Warm Craft
- Variation axes (for generating divergent mocks)
- Pattern vocabulary

---

## Selection rule

| Surface | Reach for |
| --- | --- |
| `Marketing` | any family; pick 3 spanning restrained → expressive |
| `Application` | Utilitarian Editorial, Soft Structuralism, Console, Neutral System |
| `Operations` | Console, Swiss Industrial, Neutral System |
| `Component` | host system only — no family selection |

No two directions in the same mock set may share a family. If the user names a reference or an existing project to differ from, treat that as a fourth excluded family.

---

## A. Utilitarian Editorial

Document-style, workspace-adjacent. The default that does not look defaulted.

- **Type**: geometric or neo-grotesque sans (Geist, Switzer, Söhne, SF Pro) for UI; optional editorial serif for hero only; mono for metadata and numerics
- **Color**: warm bone / off-white canvas (`#FBFBFA`, `#F7F6F3`), off-black text (`#111` / `#2F3437`), muted gray secondary (`#787774`); accents are washed pastels used semantically only
- **Surface**: ultra-flat. 1px hairline borders (`#EAEAEA`), radius 8-12px, shadows effectively absent (opacity < 0.05). No `rounded-full` containers
- **Layout**: asymmetric bento, generous internal padding (24-40px)
- **Motion**: minimal, state-driven

## B. Soft Structuralism

Airy, floating, diffuse. Consumer / health / portfolio / premium product.

- **Type**: massive bold grotesk display, comfortable body
- **Color**: white or silver-grey ground, one saturated accent
- **Surface**: **double-bezel** — outer shell (`bg-black/5`, `ring-1 ring-black/5`, `p-1.5`, `rounded-[2rem]`) wrapping an inner core with its own ground, inset highlight, and concentric smaller radius (`rounded-[calc(2rem-0.375rem)]`). Highly diffused ambient shadows, never harsh
- **Layout**: macro-whitespace (`py-24` to `py-40`), floating pill nav detached from the top edge
- **Motion**: spring/heavy cubic-bezier (`cubic-bezier(0.32,0.72,0,1)`), fade-up-with-blur entries, `active:scale-[0.98]` press feedback, nested icon-circle inside CTAs translating on hover

## C. Ethereal Glass

Dark, luminous, depth-layered. SaaS / AI / developer tools.

- **Type**: wide geometric grotesk
- **Color**: deep OLED near-black ground (`#050505`), restrained radial glow orbs. **Not** AI-purple by default — pick emerald, cyan, amber, or a brand hue
- **Surface**: vantablack panels, `backdrop-blur-2xl`, `border-white/10` hairlines, inset top highlight for edge refraction; solid-fill fallback under `prefers-reduced-transparency`
- **Motion**: slow parallax depth, glow response on hover

## D. Swiss Industrial

Print-derived, rigid, high-contrast light. Editorial, portfolio, data-heavy.

- **Type**: monolithic heavy sans (Archivo Black, Neue Haas Grotesk Black, Monument Extended) at `clamp(4rem, 10vw, 15rem)`, tracking `-0.03em` to `-0.06em`, leading `0.85-0.95`, uppercase; mono at 10-14px for metadata
- **Color**: newsprint off-white substrate, black, one primary red as alert/accent
- **Surface**: visible dividing rules. `display:grid; gap:1px` with contrasting parent/child grounds to produce razor-thin dividers without border math
- **Layout**: unforgiving modular grid, viewport-bleeding numerals, aggressive asymmetric negative space
- **Motion**: near-zero; cuts, not transitions

## E. Console / Tactical Telemetry

Dark, dense, mechanical. Monitoring, ops, developer surfaces.

- **Type**: monospace dominant (JetBrains Mono, IBM Plex Mono), uppercase metadata, tracking `0.05em-0.1em`
- **Color**: dark-mode exclusive, phosphor accent (amber / green / cyan), semantic status colors only
- **Surface**: tabular density, ASCII/technical framing devices, optional CRT scanline via `repeating-linear-gradient`, global low-opacity SVG grain on a fixed `pointer-events-none` layer
- **Semantics**: `<data>`, `<samp>`, `<kbd>`, `<output>`, `<dl>`; `font-variant-numeric: tabular-nums` everywhere numbers align
- **Motion**: none beyond state and live-data transitions

## F. Neutral System

Deliberately unopinionated — the host design system's own language. Enterprise, regulated, internal, accessibility-critical.

- Adopt Carbon / Fluent / Radix / GOV.UK / USWDS tokens as-is
- Aesthetic opinion yields entirely; the value is correctness and density
- See `design-systems.md`

## G. Warm Craft

Tactile, heritage, artisan. **Use with care** — the beige+brass+espresso variant of this family is the single most overused AI palette (see `anti-slop.md` §2). If you reach for it, use a rotated palette: forest + bone + amber, black + tan, terracotta + slate, olive + brick, cobalt + cream.

- **Type**: a justified serif (rotate; never Fraunces / Instrument Serif) or a humanist sans
- **Surface**: paper grain, physical photography, soft physical shadows
- **Motion**: slow, weighty

---

## Variation axes (for generating divergent mocks)

When two candidate mocks feel too close, force divergence on these axes rather than nudging colors:

- **Theme paradigm** — light / dark / duotone / inverted-section
- **Background character** — flat / grain / photographic / gradient field / grid
- **Type character** — grotesk / geometric / editorial serif / mono-led
- **Hero architecture** — asymmetric split / editorial manifesto / media-mask / kinetic type / scroll-pinned / product-first
- **Section system** — bento / full-bleed alternation / rule-divided list / horizontal pan / sticky stack
- **Signature component** — the one memorable element the page owns
- **Motion language** — none / reveal-only / physics / scroll-driven sequence

## Pattern vocabulary

Know these names so directions can be discussed without building them: bento grid, masonry, split-screen scroll, sticky-stack sections, horizontal scroll hijack, zoom parallax, scroll progress path, dock magnification, magnetic button, dynamic island, mega-menu reveal, parallax tilt card, spotlight border card, glassmorphism panel, morphing modal, coverflow carousel, drag-to-pan grid, hover image trail, kinetic marquee, text-mask reveal, text scramble.

## Mapping to the recipe catalogue

`style-recipes/INDEX.md` indexes its 25 anchors by six schools. Families here are materials; schools there are anchored instantiations. Use this to cross over.

| Recipe school | Closest family here |
| --- | --- |
| Editorial / Minimalist | A. Utilitarian Editorial, G. Warm Craft |
| Information Architecture | D. Swiss Industrial, F. Neutral System |
| Modern Tool / Builder SaaS | C. Ethereal Glass, A. Utilitarian Editorial |
| Motion / Experimental | C. Ethereal Glass (high motion dial) |
| Brutalist / Raw | D. Swiss Industrial, E. Console |
| Warm Humanist | G. Warm Craft, B. Soft Structuralism |
| Specialty / Genre (Y2K, mid-century) | no family — anchor-named only |

A family with no matching recipe is still valid; the catalogue is a source of anchors, not the boundary of what may be built.
