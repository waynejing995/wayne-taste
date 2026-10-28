# pi-ext-m365 — Teams and Outlook for pi and omp

One package, two halves that share everything Microsoft-side. `index.ts` registers
both; each half keeps its own tools (`teams_*`, `outlook_*`), its own command
(`/teams`, `/outlook`) and its own part of the shared status-bar row.

| Directory | What it is | Read |
| --- | --- | --- |
| `core/` | What both halves use: sign-in, Graph, people, SharePoint files, saving, picture descriptions, @mention syntax, status row, time | below |
| `teams/` | Chats: unread count, the `/teams` overlay, send/read/people/download/transcript tools, the self-chat remote channel | `teams/README.md` — read its sign-in note first |
| `outlook/` | Mail: the `/outlook` three-pane reader and composer, ten mail tools, signature | `outlook/README.md` |

## core/

| Module | Used for |
| --- | --- |
| `auth.ts` | The one Microsoft sign-in (`/teams login`, device code), token cache `~/.cache/pi/teams-auth/` |
| `graph.ts` | `GraphClient`: every Graph call, and `GraphError` |
| `people.ts` | `searchPeople` (`teams_people`, `outlook_people`) and `colleagueId` (resolving an @mention) — through `/me/people`, which the tenant does not throttle the way it throttles `/users` and `/me` |
| `shares.ts` | `downloadShared`: a SharePoint/OneDrive file by its link (`teams_download`, `outlook_download`) |
| `save-file.ts` | Writing a file without ever overwriting one: a given path must not exist, a free name gets ` (1)`, ` (2)`, … |
| `describe-image.ts` | A model-written description of a picture, cached on disk (`~/.cache/pi/teams-alt`) |
| `mention.ts` | The `@[Name](address)` syntax as a Markdown extension, so code and escaped examples never mention anyone |
| `status-row.ts` | One status-bar row for both counts (omp gives each status key its own line) |
| `tern-native.ts` | The Tern layer: TSP node builders the two overlays describe themselves with (below) |
| `time.ts` | Local time formatting |

## In Tern

When omp runs in a [Tern](https://docs.stencil.so/tern/protocol/) pane it speaks
the Tern Surface Protocol, and both overlays describe themselves as native nodes
(`describe(cx)`): Tern draws `/teams` and `/outlook` with its own lists, Markdown,
fields and keycaps, across the whole pane. Without that layer Tern shows the
terminal rows in a narrow frame labelled "fallback".

Only the drawing changes: keys still reach `handleInput`, so every shortcut is the
same; a click or double-click on a list item, or on a Yes/No button, goes to the code
path of the matching key. Elsewhere (a plain terminal, tmux, pi) nobody calls
`describe`, and the overlays draw rows as before.

Tern details the layer relies on, from omp 18.13 and Tern 0.9.5:

- the sheet body scrolls as a whole and does not pass its height down, so the panes
  get an explicit height in lines, and a list needs `max.lines` for a scroller of its own;
- Tern focuses the first `input`/`editor` a focused overlay describes, so only the
  active pane gets a field and the other shows its text;
- Tern's Markdown reads `$…$` as TeX, so `$` outside code is escaped (`mdNoMath`).

## Install

`pi-config/sync.sh` links this directory into `~/.pi/agent/extensions/m365`;
`omp-config/sync.sh` links it as the omp plugin `pi-ext-m365` and enables it.
Both install the npm dependencies once, here in `node_modules/`, and both retire
the old separate `teams` / `outlook` (`pi-ext-teams` / `pi-ext-outlook`) installs.

## Tests

```sh
npm install            # once
npm test               # node tests/run.mjs
```

All offline: no sign-in, no network. Runs Outlook's suite and the package load
check. Teams' suite is local-only (`teams/.gitignore`: it was written against a
real mailbox and holds real names and messages); it runs where it exists and is
reported as skipped in a clone. The tests load the code through pi's own jiti,
found by `tests/host.mjs` under `npm root -g`, or at `PI_CODING_AGENT_DIR`.
