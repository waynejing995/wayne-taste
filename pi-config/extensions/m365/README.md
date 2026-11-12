# pi-ext-m365 — Teams and Outlook for pi and omp

One package, two halves that share everything Microsoft-side. `index.ts` registers
both; each half keeps its own tools (`teams_*`, `outlook_*`), its own command
(`/teams`, `/outlook`) and its own part of the shared status-bar row.

| Directory | What it is | Read |
| --- | --- | --- |
| `core/` | What both halves use: sign-in, Graph, people, SharePoint files, saving, picture descriptions, @mention syntax, status row, time | below |
| `teams/` | Chats: unread count, the `/teams` overlay, send/read/people/download/transcript tools, chat watches (the self-chat takes `omp:`/`pi:` instructions) | `teams/README.md` — read its sign-in note first |
| `outlook/` | Mail: the `/outlook` three-pane reader and composer, ten mail tools, signature | `outlook/README.md` |
| `inbox/` | The inbox: a general ledger + scheduler. `inbox/cli/` is the `inbox` command (`bin/inbox`), the scheduler runs its jobs while a session is open, `/inbox watch` pushes new `notify`/`do` rows into this session as cards | [Inbox](#inbox) below |

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

## Inbox

A ledger of things that need attention (`ledger.tsv`, finished rows in `archive.tsv`), filled by rules
(`rules.yaml`: source → place → first matching rule → `do` / `notify` / `log` / `ignore`) and by scheduled jobs.
Everything lives in `~/.wayne/inbox/` (`WAYNE_INBOX_DIR` overrides it).

### Set up (once per machine)

1. Install the plugin (above) and node ≥ 22.
2. In omp or pi: `/inbox setup`, or from a shell `bin/inbox setup`. It creates `rules.yaml` from
   `inbox/templates/rules.yaml` when missing (never overwrites), starts the cursors, schedules the first fires,
   and fails naming any tool an enabled job needs and the machine lacks (`gh`/`jq` for the PR watch, `omp` or `pi`
   for prompt jobs). Fix it, or `bin/inbox schedule disable <job>`, and run setup again.
3. Edit `rules.yaml`: the template's GitHub/Outlook/agent rules are examples. `github-prs` and `teams-digest` ship
   disabled: `bin/inbox schedule enable <job>` once their section is filled in.
4. `/inbox watch` in the session that should receive the cards; `/inbox status` shows the scheduler and the rows.

Until step 2 a session shows one warning naming `/inbox setup`; no job runs and nothing is delivered.

### The command

`bin/inbox` runs `inbox/cli/` on plain node (`bin/strip-types.mjs` strips the types at load: no build step, and
unlike `--experimental-strip-types` it works under `node_modules`, where omp links the plugin). `bin/inbox --help`
lists the commands: `ls`, `add`, `set`, `done`, `ask`, `fact`, `places`, `then`, `then-done`, `agent add|rm|ls|probe`,
`schedule add|ls|rm|enable|disable|run|pending|show|exec|finish|widget`, `setup`. The plugin calls the same code
in-process.

### Jobs

`schedule` in `rules.yaml`. Every minute, the one omp/pi session that holds the scheduler lease for the inbox
directory runs the due jobs: `shell` (argv, `bin/` first on PATH), `prompt` (a headless `omp -p`, else `pi -p`,
in the inbox directory; `{{since}}` = the last successful run), or `tool` (`teams_read`). A job may be `quiet`
(writes its own rows), have a `timeout`, or be judged (`--judge on`: a small model reads the output and answers
INJECT or SKIP; omp uses the `tiny` role, pi the session model). No session open, no jobs: a missed fire runs once
at the next tick. A long job never holds back the others: later ticks skip it while it runs. The template's jobs: `agent-probe` (`inbox agent probe`), `github-prs` (`bin/watch-prs.sh`;
`bin/pr-ready.sh` answers "ready to merge?"), `teams-digest` (prompt job reading the watched Teams chats).

`inbox then <id> --when <trigger> -- <action>` keeps a promised follow-up on a live row (`pr-merged:`, `gh-run:`,
`agent-result:`, `at:` triggers): when the trigger happens, a `do` card names what is owed; one reminder after 10
minutes; `inbox then-done <id> <n>` closes it, and `inbox done` refuses the row while it is open. `inbox agent add`
requires `--row <id> --then <plan>`: the dispatcher's plan for the session's result (expected outcome, whom to reply
to, what to close) is armed as an `agent-result:<name>` then on that row.

An optional `card-note.md` in the inbox directory is said on every inbox and Teams watch card (the user's own
standing instructions for the agent that receives them).

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

All offline: no sign-in, no network. Runs Outlook's suite, the package load
check, and the Teams card tests (`tests/card.test.mjs`: the card builder, the
Graph card post, and the echo guard on cards read back). Teams' suite is local-only (`teams/.gitignore`: it was written against a
real mailbox and holds real names and messages); it runs where it exists and is
reported as skipped in a clone. It runs as `unshare -rn node teams/tests/run.mjs`
(needs util-linux and unprivileged user namespaces): a Teams watch is claimed with
an abstract socket, which belongs to a network namespace, so in a namespace of its
own the watch tests never meet a live session's watch on the same chat. Run a
single Teams suite the same way: `unshare -rn node teams/tests/watch-tool.test.mjs`.
The tests load the code through pi's own jiti,
found by `tests/host.mjs` under `npm root -g`, or at `PI_CODING_AGENT_DIR`.
