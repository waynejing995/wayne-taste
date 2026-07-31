# Layout Archetypes

Positive structure selection. Input: surface + Design Read + dials. Output: a
named page/app shell and section order, sketched as an ASCII wireframe, which
then becomes a mock direction.

**Sketch before you build.** Compare 2-3 candidate structures as ASCII
wireframes first — it costs almost nothing and exposes a wrong structure before
any code exists. Carry the winners into the mock round.

---

**Contents**

- Part 1 — Application shells
- Part 2 — Data view selection
- Part 3 — Dashboard information architecture
- Part 4 — Marketing page structures
- Part 5 — Section order by page job
- Part 6 — Sketch format

---

## Part 1 — Application shells

Pick the shell from navigation breadth and task shape, not from habit.

| Shell | Choose when | Avoid when |
|---|---|---|
| **Left sidebar** | 5-15 top-level destinations, users move between them often, deep-ish hierarchy | 3 or fewer destinations (wasted 240px), or content needs full width |
| **Top nav** | ≤ 5 destinations, content is the star, mixed marketing/app product | Deep hierarchy, or frequent lateral switching |
| **Top nav + contextual left rail** | Two-level IA: product areas across the top, per-area sections on the left | Flat IA — the second level will sit empty |
| **Master-detail (list + pane)** | The job is "work through a queue": tickets, messages, records, reviews | Items are not comparable, or each item needs the full viewport |
| **Split workbench (3 pane)** | Authoring with live context — nav, canvas, inspector | Casual or infrequent use; three panes cost orientation |
| **Full-bleed canvas + floating panels** | The artifact is the product: editor, map, diagram, board | Form-heavy or list-heavy work |
| **Command palette-led** | Power users, high task variety, keyboard-first | First-time or infrequent users — discovery dies |
| **Wizard / stepper** | Linear, mandatory, low-frequency: onboarding, filing, checkout | Any task users repeat daily — the steps become friction |
| **Single focused view** | One job, one screen: a check-in tool, a kiosk, a field capture form | Multi-entity products |

Shell rules:

- Sidebar shares the canvas background. Different colors fragment the screen
  into "sidebar world" and "content world" — a hairline border is enough.
- Sidebar width states a relationship. ~240-280px says navigation serves
  content; ~360px says they are peers. Pick the number that says what you mean.
- Nav depth beyond two levels needs breadcrumbs or the user gets lost.
- Global search, bulk actions, and filters live at the top of the content pane,
  not buried in the sidebar.
- One focal element per view — the thing the user came to do wins through size,
  contrast, position, or surrounding space. Name it before building.

## Part 2 — Data view selection

| Data shape | Reach for | Not |
|---|---|---|
| Many rows, uniform fields, needs sorting/filtering/scanning | Table, with sticky header and tabular numerals | Card grid — kills scannability |
| Items are visually distinguished (people, media, products) | Card grid | Table — wastes the visual signal |
| Time-ordered events, causality matters | Timeline / activity feed | Table sorted by date |
| Few items, each needs a decision | List with inline actions | Modal per item |
| Hierarchical, users expand selectively | Tree or nested disclosure | Flat table with an indent column |
| Comparison across a small fixed set | Side-by-side columns | Tabs — hides the comparison |
| Continuous metrics over time | Chart, with the comparison baseline visible | A bare number |

## Part 3 — Dashboard information architecture

Answer these before laying anything out. If there is no action the viewer can
take, a dashboard is the wrong format.

1. Who reads it? 2. What decision does it inform? 3. How often do they look?
4. What can they do about it?

| Archetype | Audience | Cadence | Metric count |
|---|---|---|---|
| Strategic | executives | weekly / monthly | 3-5 |
| Operational | team leads | daily | 8-15 |
| Analytical | analysts | on demand | open-ended |
| Real-time monitoring | on-call engineers | live | 10-20 |

**Metric tiers** — headline (3-5, large, top), supporting (6-10 charts giving
context), detail (tables and drill-downs).

**F-pattern** — the default. Headline row, then a dominant primary chart with a
secondary beside it, then supporting detail.

```
┌───────────────────────────────────────────────┐
│ filters                          data as of … │
├───────┬───────┬───────┬───────────────────────┤
│ KPI 1 │ KPI 2 │ KPI 3 │ KPI 4                 │  headline
├───────┴───────┴───┬───┴───────────────────────┤
│ primary chart     │ secondary chart           │  context
├───────────────────┼───────────┬───────────────┤
│ detail chart      │ detail    │ table         │  detail
└───────────────────┴───────────┴───────────────┘
```

**Z-pattern** — executive surfaces, fewer elements, narrative reading order.
**Uniform grid** — operational surfaces, equal tiles, no implied ranking.

Dashboard rules: every metric carries a comparison (target or prior period); a
chart title states the insight, not the metric name; color is reserved for
status and action while grey carries all context; the date range is visible and
user-controlled; "last updated" is always on screen. Green/red alone fails
colorblind users — pair with label, icon, or texture.

## Part 4 — Marketing page structures

Choose a hero paradigm and a section system, then check the pair against the
dials.

**Hero paradigms** — asymmetric split (text one side, asset the other) ·
editorial manifesto (type only, poster) · media-mask (type as a mask over
video) · kinetic type · scroll-pinned · product-first (the real UI or object
leads).

**Section systems** — bento tiles · full-bleed alternation · rule-divided
editorial list · horizontal pan · sticky stack · marquee-punctuated.

Structural devices must encode something true. Numbered markers (01 / 02 / 03)
belong on an actual sequence — a real process or a dated timeline — not on three
unrelated features. If a divider, eyebrow, or label is not carrying information,
delete it.

Pick one **signature**: the single element this page will be remembered by.
Spend boldness there and keep everything around it quiet.

## Part 5 — Section order by page job

| Page job | Order |
|---|---|
| Convert to trial/demo | hero → proof (logos / metric) → how it works → differentiator → objection handling → CTA |
| Explain a complex product | hero → the problem → the model (one diagram) → capabilities → integration → CTA |
| Sell a physical product | hero (product) → the one reason → detail / materials → in-use imagery → specs (grouped, not a table) → buy |
| Portfolio | hero (identity) → selected work → approach → about → contact |
| Launch announcement | hero (the news) → what changed → why it matters → availability → CTA |

Adjacent sections must not share a layout family. Eight sections need at least
four families.

## Part 6 — Sketch format

```
Direction A — <shell or hero paradigm>
┌──────────────┬────────────────────────────────┐
│ nav 264px    │ header: title · filters · new  │
│  · Inbox 12  ├────────────────────────────────┤
│  · Assigned  │ list 380px │ detail pane       │
│  · Archive   │  ▸ item    │  header           │
│              │  ▸ item    │  body             │
│              │  ▸ item    │  actions (sticky) │
└──────────────┴────────────┴───────────────────┘
focal: the detail pane · density 6 · empty state: "queue clear"
```

One sketch per candidate, one line naming the focal element, the density dial,
and the state you will show. Then build only the sketches the user reacts to.
