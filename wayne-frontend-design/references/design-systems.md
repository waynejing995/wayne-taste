# Brief → Design System

Application and Operations surfaces usually want a real, maintained design
system rather than hand-rolled tokens. Marketing surfaces usually do not.

**Honesty rule.** If the brief matches a system below, install the **official**
package. Do not recreate its CSS by hand. Do not import its tokens and then
override 90% of them. Do not call an aesthetic trend an official system.

**One system per project.** Never mix Fluent with Carbon, or shadcn components
into a Material 3 tree.

## 1. Real systems

| Brief reads as | Reach for | Install |
|---|---|---|
| Microsoft / enterprise SaaS | Fluent UI | `npm i @fluentui/react-components` (or `@fluentui/web-components @fluentui/tokens`) |
| Material-flavored product | Material Web (M3) | `npm i @material/web` |
| IBM-style B2B / enterprise analytics, dense tables | Carbon | `npm i @carbon/react @carbon/styles` |
| Shopify admin surface | Polaris | required for Shopify admin UI |
| Atlassian / Jira-style product | Atlaskit | `npm i @atlaskit/tokens` + components |
| GitHub-style devtool | Primer | `npm i @primer/react` (`@primer/react-brand` for marketing) |
| UK public-sector service | GOV.UK Frontend | `npm i govuk-frontend` — regulatorily expected |
| US public-sector / trust-first | USWDS | `npm i @uswds/uswds` |
| Accessible React foundation, own theme | Radix Themes | `npm i @radix-ui/themes` |
| Modern SaaS, you own the components | shadcn/ui | `npx shadcn@latest add ...` — never ship the default state unstyled |
| Fast local-business / agency MVP | Bootstrap 5.3 | boring, fast, works |
| Tailwind-based modern SaaS / marketing | Tailwind v4 utilities | default for indie / small-team builds |

## 2. Aesthetics that have no official package

Build with native CSS + Tailwind + a maintained component library. Be honest in
code comments about borrowed inspiration vs official material.

| Aesthetic | Honest implementation |
|---|---|
| Glassmorphism | `backdrop-filter` + layered borders + inset highlight; solid fallback under `prefers-reduced-transparency` |
| Bento tile grids | CSS Grid with mixed cell sizes. No library owns this |
| Brutalism | Native CSS, mono, raw rules. No library |
| Editorial / magazine | Serif, asymmetric grid, whitespace. No library |
| Dark tech / terminal | Mono + accent, terminal motifs. No library |
| Aurora / mesh gradients | SVG or layered radial gradients. No library |
| Kinetic typography | CSS animations, scroll-driven animations, GSAP for hijacks |
| "Apple Liquid Glass" | Apple documents this for Apple platforms only. There is **no** official web `liquid-glass.css`. Web versions are approximations — label them as such |

## 3. Default stack when no system applies

- **Framework**: React / Next.js, Server Components by default. Anything using
  motion, scroll listeners, or pointer physics is an isolated `'use client'`
  leaf. Providers wrap in a `'use client'` component.
- **Styling**: Tailwind v4 (`@tailwindcss/postcss` or the Vite plugin — not the
  `tailwindcss` PostCSS plugin). v3 only if the project demands it.
- **Animation**: Motion, imported from `motion/react`.
- **Fonts**: `next/font` or self-hosted `@font-face` with `font-display: swap`.
  Never a Google Fonts `<link>` in production.
- **State**: local `useState` / `useReducer`; global only to avoid deep drilling
  (Zustand / Jotai / context). Continuous input values (pointer, scroll,
  physics) go through motion values, never `useState`.
- **Icons**: one library per project — Phosphor, HugeIcons, Radix Icons, or
  Tabler. `lucide-react` only if the user asks or the project already has it.
  One global `strokeWidth`. Never hand-draw icon paths.
- **Breakpoints**: `sm 640 / md 768 / lg 1024 / xl 1280 / 2xl 1536`.
- **Containment**: `max-w-7xl mx-auto` or `max-w-[1400px] mx-auto`.
- **Full height**: `min-h-[100dvh]`, never `h-screen`.
- **Multi-column**: CSS Grid, not flexbox percentage math.

## 4. Dependency verification

Before importing any third-party library, check `package.json`. If it is
missing, output the install command first. Never assume a package exists.

## 5. Performance targets

LCP < 2.5s (hero image preloaded / `priority`), INP < 200ms, CLS < 0.1 (reserve
space for images, fonts, embeds). Lazy-load anything below the fold. Motion is
not tiny; Three.js is large. Keep z-index to declared systemic layers only.
