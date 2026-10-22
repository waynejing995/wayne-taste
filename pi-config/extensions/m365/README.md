# pi-ext-m365 — Teams and Outlook for pi and omp

One package, two halves that share everything Microsoft-side. `index.ts` registers
both; each half keeps its own tools (`teams_*`, `outlook_*`), its own command
(`/teams`, `/outlook`) and its own part of the shared status-bar row.

| Directory | What it is | Read |
| --- | --- | --- |
| `core/` | What both halves use: sign-in, Graph, people, SharePoint files, saving, picture descriptions, @mention syntax, status row, time | below |
| `teams/` | Chats: unread count, the `/teams` overlay, send/read/people/download tools, the self-chat remote channel | `teams/README.md` — read its sign-in note first |
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
| `time.ts` | Local time formatting |

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
