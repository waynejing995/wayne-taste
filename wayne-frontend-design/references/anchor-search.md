# Anchor Search

Where the visual reference comes from. Runs after the Design Read (SKILL.md §B),
before mocks.

**Never start from thin air.** Working from nothing is the single biggest cause
of default-shaped output. If you truly have no reference, say so out loud —
"no reference will cost quality here" — rather than quietly inventing one.

## 0. Verify facts before designing around them

If the brief names a specific product, brand, SDK, device, version, or event you
are not certain about, search and confirm before designing. Never assert an
unstable fact from memory. Banned without a prior search: "I think X hasn't
shipped yet", "X is currently on version N", "as I recall X's specs are…". If
search is ambiguous, ask.

## 1. Priority ladder

Work top-down. Stop at the first tier that yields real material.

| # | Source | Action |
|---|---|---|
| 1 | Assets the user supplied — codebase, Figma, UI kit, screenshots | Extract tokens directly. **Code beats screenshots**: if both exist, read the source and pull real values rather than guessing from pixels |
| 2 | The user's existing product surfaces | Proactively ask whether you may look at them |
| 3 | Industry references | Ask which brands or products to anchor against. For `Marketing` surfaces, awesome-design-md is one catalogue to check here — it holds brand/marketing DESIGN.md files only, so it is silent on app, dashboard, and ops work |
| 4 | A named anchor ("Linear-style", "Aesop feel", "Bloomberg terminal") | Read exactly **one** file from `style-recipes/` — see §2 |
| 5 | No asset, no product, no named anchor | **Search for real ones.** See §1.1 — the static catalogue is a fallback, not the first answer |

### 1.1 Tier 5 — mandatory live search

The recipe catalogue is 25 anchors frozen at vendor time. It cannot cover every
domain, and reaching for it by default reproduces exactly the monoculture this
ladder exists to break. When tiers 1-4 yield nothing:

1. `web_search` for **3-5 real, currently-shipping products or sites** that match
   the provisional Design Read — same surface, same audience, comparable primary
   task. Search the domain, not the aesthetic: "shift handover software
   nursing", not "clean medical UI".
2. Verify each URL resolves and the product still exists. A dead link or a
   remembered product is not an anchor.
3. Pick 2-3 as candidates. Extract from each: color system, type scale and
   pairing, spacing ladder, radius strategy, shadow hierarchy, motion character,
   component density, copy register.
4. Consult `style-recipes/INDEX.md` **after** this, to name the school the
   findings land in or to supply concrete token values the live examples do not
   expose.
5. Say plainly what you searched, what you found, and what you extracted.

**Every mock direction cites one verified anchor or example**, or states
explicitly that no suitable anchor exists for that direction and why. A
direction with no cited anchor is a default wearing a label.

## 2. Using the recipe catalogue

`style-recipes/` is a vendored catalogue of 25 anchored recipes (MIT, see its
`NOTICE.md`). Each recipe carries a role-named palette, real typefaces with
weights, a spacing ladder, 3-5 signature moves, its own anti-patterns, and a
"don't use when" boundary.

**Read `style-recipes/INDEX.md` first, then exactly one recipe file.** The
whole catalogue is ~1400 lines; one recipe is ~50. Loading everything is the
precise anti-pattern the split exists to prevent.

INDEX carries three lookups — by school, by scenario, by light/dark. Scenario is
usually the right one: developer tools, premium consumer, **data product /
dashboard / finance**, editorial, launch moment, counter-culture, approachable
B2C, retro.

Do **not** read recipes when the user supplied their own assets (tier 1-2), when
extending an existing UI (match what is there), or when the user gave a
screenshot of a specific reference — that screenshot *is* the recipe.

Recipe discipline:

- One recipe per project, instantiated fully. "Linear with Aesop accents"
  usually reads as confused, not original
- Genre recipes (brutalist, Y2K, mid-century) need full commitment — half-Y2K
  reads as a broken modern site
- Use the recipe's fonts and its restricted palette. Adding a fifth color to
  "balance it" or Inter as display erases 30-40% of the identity
- Do not add AI-default touches "to make it pop" against the recipe's own bans
- If none of the 25 fits, **say so** and propose a new anchor with its own
  concrete values and signature moves. Drifting silently produces the default

## 3. Brand work — Asset over Spec

A brand is recognised by its assets, not its hex codes. Recognition order:

| Asset | Weight | Required for |
|---|---|---|
| Logo, SVG or PNG, light and dark variants | highest | any brand task — non-negotiable |
| Product photography | very high | physical products |
| Real UI screenshots | very high | digital products |
| Color tokens | medium | auxiliary |
| Typography | low | auxiliary |

Hard rules:

- Never substitute a CSS silhouette or hand-drawn SVG for real product imagery.
  It produces generic "tech aesthetic" any brand could wear — zero recognition
- If you cannot source the logo after a real attempt, **stop and ask**. Do not
  proceed with a colored rectangle
- Recipes that depend on a photographic style (Aesop, MUJI, Stripe Press, Apple
  HIG, Headspace) fail without that imagery. A real photo at 60% quality beats a
  CSS substitute at 0% recognition

## 4. What to extract from any reference

Color system · type scale and pairing · spacing ladder · radius strategy ·
shadow hierarchy · motion character · component density · copy register.

Record what you extracted in the Design Read so the mock round can be judged
against it.
