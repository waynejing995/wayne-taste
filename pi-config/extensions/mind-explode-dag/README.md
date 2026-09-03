# mind-explode-dag

The live decision DAG of a `wayne-mind-explode` design run, above pi's input box
— plus the write tools the run records decisions through.

During an interview the frontier is the thing you keep losing: which questions
are still open, what was already settled and what it was settled *to*. It is all
in `.wayne/runs/<topic>/decision-log.jsonl`, and reconstructing it from a long
transcript is exactly the work the panel removes.

```
┌─ retry-budget · DAG MODE · following ────────────────────────────────────┐
│ ● 2   ○ 2   ◌ 1   ✕ 0   frontier· spec· in-progress   last D2            │
│ ──────────────────────────────────────────────────────────────────────── │
│  ● N1? How the retry budget is bounded                                   │
│    ↳ Retry a failed delivery three times, then dead-letter.              │
│  │ ● N2· What the delivery worker does on failure today                  │
│  │   ↳ It re-enqueues with no bound.                                     │
│ ▌│ ○ N3? Where the cap is configured, per-queue or global                │
│ ──────────────────────────────────────────────────────────────────────── │
│ ↑↓ move  ↵ detail  / search  f status  t kind  a answers✓  g follow  …   │
└──────────────────────────────────────────────────────────────────────────┘
```

`↳` is the answer, not the question. `node.decision` names what was *being*
decided; the answer lives in the resolving `decision` record, so a tree built
from node text alone shows every question the design asked and nothing it
decided.

## Using it

The panel appears on its own when a run is in progress and disappears when none
is — it costs transcript lines, so it does not sit there saying nothing.

| | |
| --- | --- |
| `/dag`, `alt+g` | take/release the keyboard |
| `↑↓` or `k`/`j` | move · `K`/`J` page · `<`/`>` ends |
| `↵` | open the full record; `esc` goes back |
| `/` | search, inline — reaches node text, ids, answers, rationale, references |
| `f` `t` | cycle status / kind filters · `c` clears everything |
| `a` `e` | answers on-off · compact-expanded |
| `g` | resume following the frontier |
| `esc` | hand typing back to the editor |
| `/dag-run` | pin a specific run, including a finished one |

`· following` means the cursor tracks the newest still-open node. Moving by hand
turns it off; `g` turns it back on. It is a heuristic, not an oracle: the log
records that several nodes are `open` and never which one is being asked.

## The write tools

`wayne_resolve_decision` and `wayne_upsert_decision_node` are registered so the
design run records through a typed call instead of hand-writing JSONL. They
inject their own usage guidance via `promptGuidelines`, so no skill file
mentions them.

`wayne_resolve_decision` is one atomic write event, because the contract says a
resolution *is* one: it appends the next consecutive decision, rewrites the node
to `resolved` naming it, and appends every child the answer opened — then
renames the whole file into place. Three separate appends would leave the log
readable in a state the design never passed through, a decision recorded against
a node still marked open.

It allocates `D` and `N` numbers itself. Rejections are thrown, so the agent
reads them and corrects inside the same turn:

```
rejected: N1 is already resolved by D1; reverse it with a new decision that supersedes it
rejected: source=codebase must cite a reference; only user, constraint and default locate their own answer
rejected: 2 runs are in-progress (a, b); pin one with /dag-run before recording decisions
```

**These tools are not a lock.** The workspace is writable and the agent has a
shell. What this layer buys is feedback inside the turn; enforcement is whatever
re-validates the log downstream.

## Boundaries worth knowing

**It is a widget, not an overlay.** `setWidget` joins pi's vertical layout, so
the transcript shrinks and nothing is hidden. A non-covering *right* rail is not
reachable from an extension: pi builds its fullscreen layout root around a
`transcriptScrollView` it never exposes, so there is no way to wrap the existing
layout in an `HStack` without rebuilding pi's dock by hand.

**Reader forgiving, writer strict.** The parser takes the last line per id, so a
half-applied rewrite still renders. The writer refuses that same log: id
uniqueness is what the next write's allocation depends on.

**Writes never move the cursor.** A tool call only triggers a rescan; where the
cursor belongs is follow mode's single answer, which the tool path and the
watcher compute identically. What changed is reported as `last D<n>` in the
header, which costs no movement.

**One recursive watcher, no polling.** It watches `.wayne/runs` for both log
writes and new runs, and watches the project root for `.wayne` first appearing —
without that, a run started mid-session would never show up.

**Arrow keys can be stolen.** An extension input listener runs before the focused
component, and pi-goal-x consumes plain arrows while its expanded dashboard is
open. `j`/`k` are there for that case; letters always reach a focused component.

## Tests

```bash
npm test    # node --experimental-strip-types tests/mind-explode-dag.test.ts
```

118 assertions, no mocks of the thing under test: a real log on disk, a real
`fs.watch`, real ANSI through `visibleWidth`. `tests/link-deps.mjs` points
`node_modules` at the installed pi on first run, so the harness exercises the
same pi-tui the extension will be handed.

The gates are grouped by what they defend: the render contracts (no line wider
than `width`, no panel taller than its declared budget), harness integrity, the
happy path, run selection, follow mode, and the write path. Every one is either
a contract this extension states or a bug that actually happened — the
selected-row height mismatch that scrolled the highlight off screen, the
duplicate-id log the writer must refuse, the hand-parked cursor a write must not
disturb.
