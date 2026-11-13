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
| `mcp/` | The same tools as an MCP server for Claude Code, Codex and Cursor, with Claude Code's channel for watch and inbox cards | [Other harnesses (MCP)](#other-harnesses-mcp) below |

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

## Other harnesses (MCP)

`mcp/server.ts` is a stdio MCP server, run with [bun](https://bun.sh) (Node's type stripping cannot load the Teams
core). It serves the same tool objects omp registers, from `teams/core.ts` and `outlook/tools.ts`: every `teams_*`
and `outlook_*` tool, plus `inbox_ls`, `inbox_ask`, `inbox_done`, `inbox_set`, `inbox_fact` and `inbox_facts`, which
run `bin/inbox`, and `inbox_watch` (see Channel). No UI: no overlays, status bar or commands. `inbox_fact` takes an optional `kind` (endpoint, cred,
decision, owed, info), passed as `--kind` only when given. `inbox_facts` wraps `inbox facts [--grep]`, which the
FactsFile branch adds: until it lands, the tool returns the CLI's own error.

- **Sign-in** is omp's: the server reads the token cache `/teams init` wrote (`~/.cache/pi/teams-auth/`) and
  refuses to start without it (`run /teams init in omp`). There is no second login.
- **Pictures** come back as MCP image content, each with the local file path (`[image n saved: <file>]`).
- **Write tools** (`teams_send`, `teams_react`, `outlook_send`, `outlook_draft`, `outlook_move`, `outlook_mark`,
  `inbox_set`, `inbox_done`) have no confirmation of their own in the server: approval is the client's job (Claude
  Code permissions or `allowedTools`, Codex `approval_mode`, Cursor's tool approval).
- **Channel**: the server always declares Claude Code's `claude/channel`. A client that can take pushes (it
  advertises `claude/channel`, or it is Claude Code, which as of 2.1.322 advertises nothing and is known by its
  `clientInfo.name`) gets `notifications/claude/channel` events, `<channel source="m365" kind=… chat_id=… sender=… policy=…>`:
  - `card`: a watched Teams chat. Same cursors, card text and per-chat lock as omp. The server has no policy gate
    model: every card reaches Claude Code, and the turn gate is a Claude Code hook (below).
  - `instruction`: your own `omp:`/`pi:` message in a watched chat.
  - `inbox`: new `notify`/`do` ledger rows, after `inbox_watch start`.
  - `notice`: what the channel resumed or skipped.

  Watching is on when you turn it on:
  - At start the server resumes the chats saved in `rules.yaml` (`teams_watch`), the self-chat included; the list is
    read, never rewritten here. A chat another session holds (a running omp) is skipped, never taken: its name and
    holder go to stderr, and `teams_watch list` shows it as held by that pid.
  - Any other chat: `teams_watch start`, the self-chat too when you ask for it.
  - The inbox: `inbox_watch start|stop|status`, omp's `/inbox watch` with the same lease and cursor. If another
    session holds the lease, it says who and takes nothing.

  The server's instructions tell Claude to reply with `teams_send` and carry the untrusted-content rules of the
  omp cards. A client that cannot take pushes (Codex, Cursor) gets the tools; `teams_watch start` and
  `inbox_watch start` are refused there, since their cards would go nowhere.

`<wayne-skills>` is where you cloned the repo. `bun` must be on the harness's `PATH` (or give its full path).

**Claude Code**: `.mcp.json` in the project (or `claude mcp add`), then launch with the development-channel flag so
Claude Code shows the pushed events:

```json
{
  "mcpServers": {
    "m365": {
      "command": "bun",
      "args": ["<wayne-skills>/pi-config/extensions/m365/mcp/server.ts"]
    }
  }
}
```

```sh
claude --dangerously-load-development-channels server:m365
```

**Codex**: `~/.codex/config.toml`:

```toml
**Turn gate** (Claude Code only): a channel event arrives as a prompt, so Claude Code's `UserPromptSubmit` hooks see
it. `mcp/claude-code-hooks.json` is a `type: "prompt"` hook that does omp's turn gate there: a `kind="card"` event
from a chat with a policy goes ahead only when, under that policy, a message needs the agent; otherwise the turn is
stopped ("Operation stopped by hook: display only: …") and the card stays on screen. Cards from the self-chat and
every other kind (`instruction`, `inbox`, `notice`) and your own prompts pass. Each channel event costs one call to
Claude Code's background model (a few seconds). Append its `UserPromptSubmit` entry to `.claude/settings.json` (or
`.claude/settings.local.json`) of the project you launch from; this keeps every hook already there:

```sh
jq --slurpfile h <wayne-skills>/pi-config/extensions/m365/mcp/claude-code-hooks.json \
  '.hooks.UserPromptSubmit += $h[0].hooks.UserPromptSubmit' .claude/settings.json > /tmp/s.json && mv /tmp/s.json .claude/settings.json
```

[mcp_servers.m365]
command = "bun"
args = ["<wayne-skills>/pi-config/extensions/m365/mcp/server.ts"]

# `codex exec` runs with approval policy "never" and refuses MCP calls that need approval;
# approve the tools it should run unattended, one table per tool:
[mcp_servers.m365.tools.teams_chats]
approval_mode = "approve"
```

**Cursor**: `~/.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "m365": {
      "command": "bun",
      "args": ["<wayne-skills>/pi-config/extensions/m365/mcp/server.ts"]
    }
  }
}
```

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
check, the MCP server test (`mcp/tests/server.test.mjs`, under bun: tool listing, a call round trip and the
channel push over an in-memory transport), and the Teams card tests (`tests/card.test.mjs`: the card builder, the
Graph card post, and the echo guard on cards read back). Teams' suite is local-only (`teams/.gitignore`: it was written against a
real mailbox and holds real names and messages); it runs where it exists and is
reported as skipped in a clone. It runs as `unshare -rn node teams/tests/run.mjs`
(needs util-linux and unprivileged user namespaces): a Teams watch is claimed with
an abstract socket, which belongs to a network namespace, so in a namespace of its
own the watch tests never meet a live session's watch on the same chat. Run a
single Teams suite the same way: `unshare -rn node teams/tests/watch-tool.test.mjs`.
The tests load the code through pi's own jiti,
found by `tests/host.mjs` under `npm root -g`, or at `PI_CODING_AGENT_DIR`.
