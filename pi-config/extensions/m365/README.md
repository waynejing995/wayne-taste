# pi-ext-m365 — Teams and Outlook for pi and omp

One package, two halves that share everything Microsoft-side. `index.ts` registers
both; each half keeps its own tools (`teams_*`, `outlook_*`), its own command
(`/teams`, `/outlook`) and its own part of the shared status-bar row.

| Directory | What it is | Read |
| --- | --- | --- |
| `core/` | What both halves use: sign-in, Graph, people, SharePoint files, saving, @mention syntax, status row, time | below |
| `teams/` | Chats: unread count, `/teams` status/unread/watch commands, send/read/people/download/transcript tools, chat watches (the self-chat takes `omp:`/`pi:` instructions) | `teams/README.md` — read its sign-in note first |
| `outlook/` | Mail: ten mail tools, status-bar unread count, `/outlook signature` | `outlook/README.md` |
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
| `mention.ts` | The `@[Name](address)` and `@[Name](app:<app id>)` syntax as a Markdown extension, so code and escaped examples never mention anyone |
| `status-row.ts` | One status-bar row for both counts (omp gives each status key its own line) |
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
lists the commands: `ls`, `add`, `set`, `done`, `ask`, `fact`, `places`, `then`, `then-done`, `agent add|close|ls|probe`,
`board list|upsert|done|setup`, `schedule add|ls|rm|enable|disable|run|pending|show|exec|finish|widget`, `setup`. The plugin calls the same code
in-process for its own cards and scheduler.

Agents get the ledger as tools, so they do not shell out: `inbox_ls`, `inbox_ask`, `inbox_fact`, `inbox_facts`,
`inbox_fact_drop`, `inbox_set`, `inbox_done`, `inbox_then`, `inbox_then_done`, `inbox_agent_add`, `inbox_agent_close`,
`inbox_agent_ls`.
omp and the MCP server register the same definitions (`mcp/inbox.ts`). Each call runs `bin/inbox` as a child
process: the ledger lock waits synchronously, which in-process would stall the whole session.

### Jobs

`schedule` in `rules.yaml`. Every minute, the one omp/pi session that holds the scheduler lease for the inbox
directory runs the due jobs: `shell` (argv, `bin/` first on PATH), `prompt` (a headless `omp -p`, else `pi -p`,
in the inbox directory; `{{since}}` = the last successful run), or `tool` (`teams_read`). A job may be `quiet`
(writes its own rows), have a `timeout`, or be judged (`--judge on`: a small model reads the output and answers
INJECT or SKIP; omp uses the `tiny` role, pi the session model). No session open, no jobs: a missed fire runs once
at the next tick. A long job never holds back the others: later ticks skip it while it runs. The template's jobs: `agent-probe` (`inbox agent probe`), `github-prs` (`bin/watch-prs.sh`;
`bin/pr-ready.sh` answers "ready to merge?"), `teams-digest` (prompt job reading every Teams chat active since the
last verified run into `facts.md` and `ask` rows).

`teams-digest` is checked, not trusted. Its prompt ends with `{{receipt}}`, which the runner replaces with the
receipt the agent must print (`inbox/cli/digest.ts` holds both the text and the parser). The runner runs it with
`--mode json` and checks the event stream: every chat `teams_chats active_since` listed, plus the self-chat, needs a
successful `teams_read` over the whole window (`since` .. `until`), every middle omp elided from a long result must
be read back from its `artifact://N`, and every `inbox ask|fact` must succeed. A window spans at most a day: a longer
gap (a backfill, a week offline) is read one day per fire, each verified window moving `backfill_since` to its end
and firing again at the next tick. Only the verified window that reaches the fire moves `last_ok` and clears
`backfill_since`; a dispatch, skip, `schedule finish` without the stream, exit, timeout or unread chat keeps both
and writes one `do` row per chat (`Teams digest could not fully read <chat> since <boundary>`). The job's action
kind is `digest`, not `prompt`: a build from before the receipt contract fails on that kind ("unknown action") and
keeps `last_ok`, instead of running the new prompt unchecked. An older `prompt` digest fails until
`bin/inbox rules-migrate` replaces it from the template (a watched-chats prompt also gets a 7-day `backfill_since`).
Restart every omp/pi session on the new build before running `rules-migrate`, so no old scheduler is left to fire it.
For the same reason, run `node --experimental-strip-types inbox/cli/migrate-facts.ts --dir ~/.wayne/inbox` again after the last session has restarted: an old
build keeps writing `teams-fact` ledger rows until it restarts, and only a rerun moves those into `facts.md`. A row it
refuses (bad key or metadata-shaped text) stays open and is listed; the run exits 1.

End to end against real Teams (read-only, network, not in `npm test`): `node tests/e2e/digest.mjs --out DIR`. It
runs `inbox schedule run --job teams-digest` with a real `omp` in temporary inboxes, from the template and from a
migrated copy of `~/.wayne/inbox/rules.yaml` (`--live-rules FILE`; read, never written), and checks a first and an
incremental run, the backfill window by window, and each failure path; `DIR/summary.json` lists every check, each
step's files sit beside it.

`inbox then <id> --when <trigger> -- <action>` keeps a promised follow-up on a live row (`pr-merged:`, `gh-run:`,
`agent-result:`, `at:` triggers): when the trigger happens, a `do` card names what is owed. A fired then left open
gets one reminder per check, due 10 minutes, 1 hour, 4 hours, then daily after its last card, and that reminder
archives the previous card. `inbox then-done <id> <n>` closes the then and archives its card. `inbox done` refuses
that card (`--force` or not) and names `inbox then-done`; it also refuses the row while a fired then is open.
`inbox agent add <name> --mux <mux> --pane <pane>` watches the agent session that runs in that pane. It probes the
pane first and refuses one that is not there or holds no agent process, then prints what it attached to: the agent
pid, the session id, the phase, the RESULT file with its status and version, and how many reporter events that
session has on the host (none: only the probe watches it). `--row <id> --then <plan>` go together and are optional:
the dispatcher's plan for the session's result (expected outcome, whom to reply to, what to close) is armed as an
`agent-result:<name>` then on that row, against the RESULT version that already exists, and closes the name's
previous unfired plans. A result row is one per RESULT version, and a session keeps one live attention row.

Each watch has one record in `cursors/agents.json` (`inbox/cli/observed.ts`): its phase (working, asking, idle, gone),
when and by whom it was last seen, and the agent process last seen in the pane (pid, session, cwd). Two sensors write
it under one lock, and neither keeps a copy in memory: `inbox agent probe` looks at every watch on each run, and the
plugin tails the reporter events of every watch (`agent-events.jsonl`, locally or over ssh; its own state is only the
byte cursors in `cursors/agent-events.json`). An observation older than the record is dropped, and a row is made on a
change of the record by whichever sensor sees it first, so a turn end both see is one row. A first observation makes
no row but a RESULT version nobody reported; the record of a name that is no longer watched is deleted on the next
probe.

A watch is its omp session (host + session id); the pane is where it is now. The reporter
(`omp-config/extensions/wayne-agent-report.ts`) writes for every root session that runs in a tern, tmux or herdr pane,
named (`WAYNE_AGENT_WATCH`) or not, and each event carries the session, its file, cwd, mux and pane. An event reaches
the watch whose record holds that session; else the live watch whose record holds that process (the same omp switched
session); else the watch of the event's name whose record holds no agent yet or whose agent is gone (a watch not
probed yet, a mux that names no agent process). Any other event is dropped: a second session under a watched name
does not reach a live watch, and an event of a name that is not watched makes nothing. When a matched event names
another pane of the entry's mux, the entry's `pane` is rewritten: a session resumed into another pane keeps its
watch. Row keys carry the name and the session, never a launch id; entries and thens written by older builds keep
their `generation`, `stamped`, `instance` and `push` fields, which nothing reads.

| Change | Row |
| --- | --- |
| turn end with a new RESULT version | `event=result`, key `agents:<name>:result:<version>` |
| turn end without one | `event=idle state=no-result`, the note carries the last output |
| the session asks | `event=ask`, key `agents:<name>:ask:<id>`, the note carries the question and its options. The tailer records it at once, the probe on its second sighting (an ask answered between two probes is no row) and only when no live row already shows it |
| the session stops asking | its live, unclaimed ask rows are archived (`[ask resolved in the session]`) |
| no agent process in the pane (probe only; tern and tmux: the pane holds only shells) | `event=ended state=gone`, key `agents:<name>:gone:<agent pid>`, the note says how to resume: `cd <cwd> && omp --resume <session>`, then `inbox agent add` on the new pane |
| working, and quiet for `--stall-min` | `event=stalled` |

A reporter's exit makes no row and no phase: only the probe says a session is gone. `inbox agent ls`
ends each line with the phase last recorded (plus ` closing`) and never rewrites the list.

Only `inbox agent close <name>` ends a watch. Alone, it probes the session and prints, as its error, whether the pane
is alive, its phase (working, asking, idle, gone), idle minutes, the newest RESULT file with its version, `status`,
`open` and `verified` lines, and the watch's open thens; nothing is closed. `--ack <version> --note <what you
verified>` (`--ack none` when there is no RESULT) closes it: refused when the version is no longer the current one,
when the session is working or asking, or while a fired then of the watch is open. The watch's unfired thens are
closed with the note; a gone session's entry is removed, and a live idle one is marked `closing`: kill its pane, and
the next probe removes the entry (it still records a RESULT version written in between, and makes no `gone` row).
In the session that loads the plugin, a `bash` call that kills a watched pane (`tern kill|close`, `tmux
kill-session|kill-pane|kill-window|kill-server`, `herdr pane close`, also inside `ssh`) is blocked until the close
was acknowledged.

A session that stopped without a new RESULT (an idle, ask or blocked row) gets a verdict: `inbox done <id>` refuses
that row, `--force` or not, without `--verdict advanced|waiting-user|nothing-pending --note <text>`. `advanced` and
`nothing-pending` archive it with the verdict in the note; `waiting-user` keeps the same row live as an `ask-wayne`
notify row that the session's later rows do not replace, and a plain `inbox done <id> --note …` archives it once
answered. The card of such a row says so. A turn end whose last output equals the previous no-result row's (same
watch and session, live or closed) makes no new row: a session idle on its own subagents ends a turn per subagent
message with nothing new to read (`cursors/agent-said.json` keeps what the last one said).

An optional `card-note.md` in the inbox directory is said on every inbox and Teams watch card (the user's own
standing instructions for the agent that receives them).

### Task board (`teams_board` / `inbox board`)

A `mode: personal` channel entry in `~/.wayne/inbox/rules.yaml` (`teams_watch.channels`) can carry an optional
`board:` block pointing at a SharePoint / Microsoft Lists Kanban board (zero IDs live in code; `teams_watch` edits
preserve the `board:` block):

```yaml
teams_watch:
  channels:
    - channel: my-agent
      team_id: 00000000-0000-4000-8000-000000000010
      channel_id: 19:fake-channel@thread.skype
      mode: personal
      policy: ""
      board:
        site_url: https://tenant.sharepoint.com/sites/MySite
        list_id: 00000000-0000-4000-8000-000000000000
        columns: # optional, defaults shown
          waiting: "🟡 待拍板"
          working: "🔄 进行中"
          done: "✅ 已完成"
```

- **`teams_board`** (and `bin/inbox board list|upsert|done|setup`): `list` lists cards, `upsert` creates/updates by
  `thread_id` (`status`: `waiting` | `working` | `done`, auto-building a `<= 255`-char `ThreadLink` from the personal
  channel and token `tid` claim when `thread_url` is omitted, stripping `&createdTime=...`), `done` moves a card to
  the done column (no-op if absent), and `setup` creates missing columns (`board_x0020_choice`, `Summary`,
  `ThreadLink`, `ThreadId`) and patches the `KANBAN` `Board` view's `CustomFormatter` with `kanbanProps.formatter`.
- **`teams_react("✅")`** on a root post of that personal channel moves the matching card to `done` (warning in the
  tool output if SharePoint sync fails, without hiding the Teams reaction success).

## Other harnesses (MCP)

`mcp/server.ts` is a stdio MCP server, run with [bun](https://bun.sh) (Node's type stripping cannot load the Teams
core). It serves the same tool objects omp registers, from `teams/core.ts` and `outlook/tools.ts`: every `teams_*`
and `outlook_*` tool, plus the inbox tools above (from `mcp/inbox.ts`, which run `bin/inbox`), and `inbox_watch`
(see Channel). No UI: no overlays, status bar or commands. `inbox_fact` wraps `inbox fact` and, like it, requires a
`kind` (endpoint, cred, decision, owed, info); `inbox_facts` wraps `inbox facts [--grep]`; `inbox_fact_drop` wraps
`inbox fact-drop KEY`.

- **Sign-in** is omp's: the server reads the token cache `/teams init` wrote (`~/.cache/pi/teams-auth/`) and
  refuses to start without it (`run /teams init in omp`). There is no second login.
- **Pictures** come back as MCP image content, each with the local file path (`[image n saved: <file>]`).
- **Write tools** (`teams_send`, `teams_react`, `teams_board`, `outlook_send`, `outlook_draft`, `outlook_move`, `outlook_mark`,
  `inbox_ask`, `inbox_fact`, `inbox_fact_drop`, `inbox_set`, `inbox_done`, `inbox_then`, `inbox_then_done`, `inbox_agent_add`,
  `inbox_agent_close`) have no confirmation of their own
  in the server: approval is the client's job (Claude Code permissions or `allowedTools`, Codex `approval_mode`,
  Cursor's tool approval).
- **Channel**: the server always declares Claude Code's `claude/channel`. A client that can take pushes (it
  advertises `claude/channel`, or it is Claude Code, which as of 2.1.322 advertises nothing and is known by its
  `clientInfo.name`) gets `notifications/claude/channel` events, `<channel source="m365" kind=… chat_id=… sender=… policy=…>`:
  - `card`: a watched Teams chat. Same cursors, card text and per-chat lock as omp. The server has no policy gate
    model: every watched-chat card is pushed to Claude Code with no turn gate, and the agent applies the chat's policy itself.
  - `instruction`: your own `omp:`/`pi:` message in a watched chat.
  - `inbox`: new `notify`/`do` ledger rows, after `inbox_watch start`.
  - `notice`: what the channel resumed or skipped.

  Nothing is watched until you ask. Claude Code sends the same handshake whether or not it registered the channel,
  and a `claude -p` run or a session without the dev-channel flag drops every event silently, so the server cannot
  tell a live channel from a dead one and claims nothing when it starts. Ask, in an interactive session started with
  `--dangerously-load-development-channels server:m365`:
  - `teams_watch start` with no chat: resume the chats saved in `rules.yaml` (`teams_watch`), the self-chat included;
    the list is read, never rewritten here. A chat another session holds (a running omp) is skipped, never taken:
    the reply and stderr name it and its holder, and `teams_watch list` shows it as held by that pid.
  - `teams_watch start` with a chat: that chat, the self-chat too when you ask for it.
  - `inbox_watch start|stop|status`: omp's `/inbox watch` with the same lease and cursor. If another session holds
    the lease, it says who and takes nothing.

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
