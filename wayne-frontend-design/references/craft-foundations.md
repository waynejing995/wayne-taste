# Craft Foundations

The positive moves. `anti-slop.md` says what not to do; this says what produces hierarchy. Applies to every surface and every aesthetic family.

Defaults hide in the parts that feel like infrastructure — typography feels like a container, navigation feels like scaffolding, tokens feel like implementation detail. None of them are. There are no structural decisions; everything is design.

**Contents**

- 1. One focal point per view
- 2. Type scale is a ratio
- 3. Density is a number, not a mood
- 4. Spatial rhythm — breathe unevenly
- 5. Proportions speak
- 6. Distribution and restraint
- 7. Surface elevation
- 8. Tokens name a world
- 9. Copy is design material
- 10. Self-checks before showing

---

## 1. One focal point per view

Every screen has one thing the user came for. That thing wins — through size, contrast, position, or the space around it. Name it out loud before building, then demote everything else deliberately. When everything competes equally, nothing wins and the screen reads as a parking lot.

## 2. Type scale is a ratio

Do not pick sizes by feel. Pick a ratio and step it:

| Ratio              | Use                    |
| ------------------ | ---------------------- |
| ~1.2 (minor third) | dense or calm UI       |
| ~1.25              | most product UI        |
| ~1.333             | expressive / marketing |

From a 14-16px body this yields a visibly distinct scale, not 15/16/17 mush. 14px base at 1.25: `caption 11 · body 14 · h4 16 · h3 18 · h2 22 · h1 28 · display 44+`. Round to whole pixels and onto the spacing grid.

**Weight and color do more hierarchy work than size.** A single 14px size holds three tiers through weight plus opacity — value `600/primary`, label `500/secondary`, meta `400/muted` — more cleanly than two regular weights two points apart. Build from three levers together, never size alone.

Worked example, a metric. _Flat_: `Revenue` and `$48,200` both 14px regular grey in three identical boxes — no focal point. _Decided_: `REVENUE` 11px/500/muted/tracked · `$48,200` 28px/600/primary/`tabular-nums` · `↑12%` 12px/500/success. Same data, opposite legibility.

Squint test: if you cannot tell headline from body from label, the hierarchy is too weak.

## 3. Density is a number, not a mood

Decide density up front and name the values. A tool panel at 12-16px padding feels workbench-tight; the same card at 24px feels like a brochure. Neither is default — both are chosen, and the choice is the same number repeated everywhere. Map the `VISUAL_DENSITY` dial to concrete padding, row height, and gap values, then hold them.

## 4. Spatial rhythm — breathe unevenly

Great interfaces do not space everything equally. Group tightly-related things, then put real air between groups. Dense control zones give way to open content. Same card, same gap, same density everywhere is the sound of no one deciding.

## 5. Proportions speak

A 280px sidebar next to full-width content says "navigation serves content". A 360px sidebar says "these are peers". The number declares a relationship. If you cannot articulate what a proportion is saying, it is not saying anything.

## 6. Distribution and restraint

- **60/30/10** — a dominant neutral surface, a secondary tone, ~10% accent. Color is scarce; most of the screen is structure.
- **One accent used with intent** beats five used without. Grey builds structure; color communicates status, action, identity. Unmotivated color is noise.
- **Hierarchy through space and weight before lines.** Reach for whitespace and tonal shift before borders and dividers. The most premium interfaces are mostly invisible structure.
- **Optical sizing.** Tighten tracking as type grows (slight negative on headings); loosen line-height on body (~1.5). Default tracking on a 32px heading reads as a document, not a design.

## 7. Surface elevation

Surfaces stack: a dropdown above a card above the page. Build a numbered ladder where each step is a few percentage points of lightness — dark mode base → +7% → +9% → +12%; light mode stays light and adds shadow instead. One step is barely visible alone; stacked, the hierarchy emerges.

- **Sidebars** share the canvas background. A hairline border is enough.
- **Dropdowns and popovers** sit exactly one level above their parent, or layering is lost.
- **Inputs** are slightly _darker_ than their surroundings, not lighter. An input is inset — it receives content. A darker fill says "type here" without heavy borders.

## 8. Tokens name a world

`--ink` and `--parchment` evoke a product. `--gray-700` and `--surface-2` evoke a template. Someone reading only your token names should be able to guess what the product is.

## 9. Copy is design material

- Name things by what people control, not by how the system is built. A person manages notifications, not webhook config.
- Active voice, sentence case, plain verbs. A control says what happens: "Save changes", not "Submit".
- An action keeps its name through the whole flow — the button that says "Publish" produces a toast that says "Published".
- Errors do not apologise and are never vague: what happened, how to fix it.
- An empty screen is an invitation to act, not a mood.
- Each element does exactly one job. A label labels; an example demonstrates.

## 10. Self-checks before showing

- **Swap test** — swap your typeface for the usual one and your layout for a standard template. Would anything feel different? Where swapping does not matter is where you defaulted.
- **Squint test** — blur your eyes. Is hierarchy still readable? Is anything jumping out harshly?
- **Signature test** — point to five specific elements where the signature appears. "The overall feel" does not count.
- **Token test** — read the CSS variable names aloud. Do they belong to this product's world, or to any project?
- **Sameness test** — would another agent, given a similar brief, produce substantially the same thing? If yes, the direction came from defaults.
