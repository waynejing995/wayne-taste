# wayne-inbox internals

How the watchers, files and jobs work. Read this only to change or debug the inbox, not to handle a card.

The inbox itself (CLI, scheduler, PR watch, agent probe, Teams digest job, card delivery) is the m365 plugin's `inbox/` (`pi-config/extensions/m365/`, see its README). This skill keeps what is Wayne's: the role, his `rules.yaml`, his card note, and `trace-monitor`.

## Files (all under `~/.wayne/inbox/`, never in a repo)

| File | Owner | What |
| --- | --- | --- |
| `rules.yaml` | Wayne (hand-written; `inbox setup` creates it from the plugin's `inbox/templates/rules.yaml` when missing); `teams_watch` by the m365 extension; `agent_watch` by `inbox agent`; `schedule` by `inbox schedule` and the scheduler (`next_fire`, `last`, `last_ok`) | classification rules per source/place, the Teams watches to resume, the agent sessions to watch, the scheduled jobs |
| `ledger.tsv` | `inbox` CLI | live rows only: `open` or `claimed` |
| `archive.tsv` | `inbox done` | finished rows (`state` = `done`); keeps their keys so an event is never recorded twice |
| `cursors/github-prs.since` | plugin `bin/watch-prs.sh` (job `github-prs`) | last PR scan time |
| `cursors/schedule-<job>-<fire>.claim` | scheduler | one fire claimed, so two runners never run it twice; stale after 15 min (or the job's timeout + 1 min) |
| `thens.json` | `inbox then` / `then-done`; the scheduler marks `fired` / `reminded` | deferred actions: row, trigger, action, when added, which ledger id was newest then (an `agent-result` trigger only counts a later RESULT row) |
| `card-note.md` | Wayne (copy of `templates/card-note.md` in this skill) | the standing note said on every inbox and Teams watch card; no file, no note |
| `cursors/session-push.id` | m365 extension | highest ledger id already pushed to the session |
| `cursors/outlook-inbox.since` | m365 extension | last mail recorded (only when `outlook:` exists in rules.yaml) |
| `cursors/agents.json` | `inbox agent probe` (job `agent-probe`) and the m365 extension's event tailer, under one lock | one record per watch: phase, last observation (`at`, only forward), the agent's pid/session/session file/cwd, a pending ask, last activity, last digest entry; `digest.at`: when the last progress digest was sent |
| `cursors/agent-said.json` | `inbox` CLI | per watch: the session and last-output hash of its last no-result row, so a repeat makes no row |
| `agent-events.jsonl` | `wayne-agent-report` extension in every root omp session in a mux pane (on the host it runs on) | one JSON line per state change: `started`, `working` (`prompted`: whether a submitted prompt started the turn), `ask`, `ask-resolved`, `idle`, `result` (only for a new RESULT version), `ended`; older reporters also wrote `hb`; append-only, the durable queue |
| `cursors/agent-events.json` | m365 extension | per host: byte offset and inode already read from `agent-events.jsonl` |
| `cursors/trace-monitor.posted.json` | `scripts/trace-monitor.py` | finding keys already posted to Teams; written only after a successful `--post` |
| `cursors/trace-monitor.verdicts.json` | `scripts/trace-monitor.py` | magpie verdict cache (finding key + hash of the judged text), so reruns do not call the model again |

The plugin's `inbox/templates/rules.yaml` is a mock example. Never copy real chat ids, PR numbers or people into it.

## Flow

```mermaid
flowchart LR
  T[m365 scheduler: every minute while an omp/pi session with the plugin is open, one per inbox dir] --> W[job github-prs: bin/watch-prs.sh]
  W -->|inbox add| L[(ledger.tsv)]
  T --> G[job agent-probe: inbox agent probe, sessions without push]
  G -->|inbox add| L
  R[wayne-agent-report in each pushed omp] -->|append| E[(agent-events.jsonl, per host)]
  E -->|local dir watch / ssh tail -F| X[m365 extension: agents tailer]
  X -->|inbox add| L
  O[m365 extension: Outlook poll, only with outlook: in rules.yaml] -->|inbox add| L
  T --> D[job teams-digest: headless omp/pi reads teams_watch chats + self-chat]
  D -->|inbox ask / fact| L
  T --> J[other schedule jobs: shell / prompt / teams_read, optional judge]
  J -->|schedule row| L
  L -->|new notify / do rows| S[session that ran /inbox watch]
  S -->|inbox done| A[(archive.tsv)]
```

`wayne-inbox-trace-monitor` (systemd user timer, 30 min) runs `scripts/trace-monitor.py --post` outside the ledger: it reads TRACE prod Postgres read-only through `TRACE_MONITOR_PROD_CMD` (window: the last `--days`, default 2), has a small magpie model (`--model`, `TRACE_MONITOR_MODEL`) judge Captain replies and needs_attention texts, adds TRACE-side failures from `run_reviews` and personal Captain chats silent for 7 days, and posts one digest of findings not posted before (one line per TRACE task) to the TRACE group (`TRACE_MONITOR_GROUP_CHAT`) through headless omp `teams_send`. A run counts as sent only on a `teams_send` receipt in omp's `--mode json` output; only then are the keys added to `trace-monitor.posted.json`. Without `--post` it is a dry run that prints the digest; `--target self` sends to the self-chat; `--calibrate` checks the judge on the three calibration cases. To stop posting, drop `--post` from the unit's ExecStart and `systemctl --user daemon-reload`. Tests: `cd scripts && uv run --with pytest --with click --with loguru --with httpx pytest -q test_trace_monitor.py`.

Site values are not in the repo; the unit sets them as environment variables (a drop-in under `~/.config/systemd/user/wayne-inbox-trace-monitor.service.d/`). A missing one stops the run before any prod query:

| Variable | Flag | Value |
| --- | --- | --- |
| `TRACE_MONITOR_PROD_CMD` | `--prod-cmd` | a local command that runs its stdin as bash on the TRACE prod host and prints the output; how it reaches the host and authenticates lives only in that local script |
| `TRACE_MONITOR_TRACE_URL` | `--trace-url` | TRACE dashboard base URL (`<url>/tasks/<id>` links) |
| `TRACE_MONITOR_JIRA_URL` | `--jira-url` | Jira base URL (`<url>/browse/<ticket>` links) |
| `TRACE_MONITOR_GROUP_CHAT` | `--group-chat` | Teams chat id of the TRACE group; needed for `--post --target group` |
| `TRACE_MONITOR_RULES` | `--rules-file` | handling-rules markdown; needed for `--preprocess` (`TRACE_MONITOR_PREPROCESS=1`) |

`watch-prs.sh` with no arguments watches the repos listed under `github:` in `rules.yaml` (`inbox places github`); none listed is an error. The `github-prs` job runs it (needs `gh` and `jq`). It records new reviews, completed checks and merges of your PRs. A review or PR comment whose body contains `Multi-source auto-review` (the TRACE auto-review, posted from your own login) is recorded as `event=review actor=auto-review`, keyed `…:review:<id>` or `…:comment:<id>`; other PR comments are not read.

- `rules.yaml`: `source -> place -> [rules]`, first match wins. `when` is exact match (list = any, `"!x"` = not x). `action`: `do` (card starts a turn), `notify` (card shown, waits for Wayne), `log` (ledger only, not pushed), `ignore` (not recorded). A place with no rules is not recorded.
- GitHub fields: `number`, `event` (`review | check | merged`), `state`, `actor` (reviewer login, or `auto-review`; review only), `verdict` (`clean` when the body says "no critical", up to two words between, e.g. "No new CRITICAL issues", has no CRITICAL heading or item, and no line says findings are still open, present or unresolved; else `critical`; the rule is in the plugin's `bin/auto-review.sh`) and `commit` (the reviewed sha, up to 9 characters, when the body names one) on auto-reviews. Put the `actor: auto-review` rule above an `actor: <your login>` ignore rule. To watch a PR, add its number to the `number` lists of that repo; to stop, remove it.
- A place may be `"*"`: the source's rules for any place with none of its own (agent sessions are named at run time).
- One session delivers at a time (abstract-socket lease per inbox directory). It ends with the session.

## Commands

```bash
I="$WAYNE_SKILLS_DIR/pi-config/extensions/m365/bin/inbox"   # plain node >= 22; the plugin calls the same code in-process
$I setup                                # rules.yaml from the template if missing, cursors, first fires; fails naming a missing tool
$I ls                                   # live rows (open + claimed)
$I set <id> --state claimed --owner <who>
$I done <id>... --note <outcome>        # finished: out of the ledger, into archive.tsv
$I add --source github --place <repo> --key <k> --subject <s> --field k=v ...   # what the watchers call
$I ask "<question>" --key <k> --note <where>   # someone waits for Wayne: ask-wayne notify row
$I fact --kind endpoint|cred|decision|owed|info "<fact>" --key <k> --note <chat, who, time>   # upsert facts.md; facts [--grep TEXT] reads it; fact-drop <key> removes it
$I schedule add <name> --every <min> | --cron '<m h dom mon dow>' --kind shell|prompt|tool --action <argv JSON | text | {name,args}> [--judge on --judge-prompt …] [--quiet] [--timeout s] [--tools a,b] [--disabled]
$I schedule ls | rm | enable | disable | run --due | run --job <name>
$I then <id> --when <trigger> -- <action>   # deferred action on a live row (see Then-actions)
$I then-done <id> <n> [--note <why>]
$I done <id> --force --note <why>       # also closes the row's fired, open then-actions
```

In omp or pi: `/inbox setup`, `/inbox watch` (deliver here), `/inbox stop`, `/inbox status` (where the scheduler runs, each job's next fire and last result, the open rows).

## Jobs

The scheduler runs in the plugin, not in systemd: every minute, in the first omp or pi session on this inbox directory that holds the scheduler lease (any session with the plugin, `/inbox watch` or not). Nothing runs while no such session is open; a missed fire runs once at the next tick. The tick does not wait for its jobs: a job still running (a 15-minute digest) is skipped by later ticks, which keep running the other due jobs and the then-actions. A shell job's argv has the plugin's `bin/` first on PATH, so `inbox`, `watch-prs.sh` and `pr-ready.sh` resolve. A prompt job runs `omp -p` (else `pi -p`, or `INBOX_AGENT`) in the inbox directory, `{{since}}` replaced by the last successful run (24 h ago at first). A `quiet` job records no row when it succeeds (it writes its own rows); a failure always records a `notify` row. A judged job's output goes to a small model (omp: the `tiny` role; pi: the session model) that answers INJECT or SKIP.

## Then-actions

`inbox then <id> --when <trigger> -- <action>` hangs a follow-up on a live row. Triggers: `pr-merged:<owner/repo>#<n>` (the PR watch's `github:<repo>#<n>:merged` row exists), `gh-run:<owner/repo>:<run-id>` (`gh run view` says completed), `agent-result:<name>` (a RESULT row for that agent newer than the then, other than the RESULT version it was armed on), `at:<YYYY-MM-DD HH:MM>`. The delivering session checks on every inbox change; the scheduler tick also checks `gh-run`, `at:` and reminders. A trigger makes one `do` row (`then` tag, owner `coordinator`): "Trigger X happened; you owe: <action>". An open then has one live card: a reminder is due 10 minutes, 1 hour and 4 hours after its last card, then daily, one per check, and it archives the previous card. `inbox then-done <id> <n>` closes the then and archives its card; `inbox done` on a then card refuses and names that command. `inbox done <id>` refuses while a fired one is open (`--force --note` overrides). Closing a then never ends a watch. An unfired then stays armed after its row is done. `inbox ls` and `/inbox status` list the open ones.

## Agent sessions

To start one, use the `delegate-agent-session` skill: it writes the brief, launches omp in tern, herdr or tmux (local or an ssh host), and registers the session here. Every agent session Wayne or an agent wants followed goes on the `agent_watch` list:

```bash
$I agent add <name> --mux tern|herdr|tmux --pane <tern block id | herdr agent | tmux target> \
  [--host <ssh host>] [--result <deliverable file with the RESULT block>] [--goal "<one line>"] \
  [--row <live row id> --then "<plan for its RESULT: expected outcome, whom to reply to and how, what to close>"]
$I agent ls                              # last column: phase (working, asking, idle, gone; ` closing` after an acknowledged close)
$I agent close <name> [--ack <version|none> --note "<what you verified>"]
```

A watch is the omp session (host + session id); the pane is only where it runs now. `agent add` probes the pane first: it refuses a pane that does not exist or holds only shells, and prints what it attached to (agent pid, omp session id, phase, RESULT file/status/version, how many reporter events that session has on its host, the armed then). herdr and hc do not name the agent process: there the add says `agent process unknown`, and the session's first event binds it by name. `--row`/`--then` go together and are optional: they arm an `agent-result:<name>` then on that row, which fires on the next RESULT version (not the one that exists at arm time), and `done` of the row refuses until the then is closed. Adding the same name again replaces the entry and, with `--then`, closes the name's previous unfired `agent-result` thens. Entries that still carry `generation`, `stamped`, `instance`, `migratedGeneration` or `push` from older builds are read as before; those fields are ignored and never rewritten.

The watch lives as long as the session: closing its thens never removes it. Only `agent close` does. Without `--ack` it probes the pane and prints liveness, phase, idle minutes, the RESULT file and version, its `status:`/`open:`/`verified:` lines and the open thens, and refuses. With `--ack <version> --note` it refuses while the RESULT version differs from `--ack`, the session is working or asking, or a fired then is open; otherwise it closes the name's unfired thens, removes a gone session's entry, and marks a live idle one `closing` (the probe removes it once its pane is gone). In omp and pi, a `bash` call with `tern kill|close`, `tmux kill-*` or `herdr pane close` on a watched pane is blocked until its close is acknowledged, and names the close command.

### One record per watch, two sensors

`cursors/agents.json` holds one record per watch: `phase`, `at` (only moves forward; an older observation is dropped), `by` (`event` or `probe`), `agent{pid, session, sessionFile, cwd}` (kept after `gone`), `ask{id, sightings}`, `active`, `digested`. Both sensors write it under its lock; a row is made when the record changes, by whichever sensor sees the change first, so one turn end seen by both is one row.

- Event sensor. Every root omp session in a mux pane (`TERN_PANE`, `TMUX_PANE` or `HERDR_PANE_ID` set), or launched with `WAYNE_AGENT_WATCH`, runs the `wayne-agent-report` extension (`omp-config/extensions/wayne-agent-report.ts`, linked into `~/.omp/agent/extensions/`) and appends one line per state change to `agent-events.jsonl` on its own host, carrying `session`, `sessionFile`, `cwd`, `mux`, `pane` and, on a turn end, `result{path,status,open,version}`. It sends `result` only when the RESULT version changed since its last `result`; any other turn end is `idle`. Nested `omp -p` runs and subagents do not report. The session running `/inbox watch` tails that file: the local one on every inbox-directory change; each remote `--host` one through a long-lived `ssh -o ServerAliveInterval=30 <host> tail -c +<offset+1> -F agent-events.jsonl`, reconnected after it exits (5 s doubling to 60 s) from the stored byte offset (`cursors/agent-events.json` keeps only `{ hosts }`). No timer is involved in delivery.
- Matching. An event goes to the watch on its host whose record holds its session; else to the live watch whose record holds its pid (the same omp switched session); else to the watch of its name whose record holds no agent yet or is gone. An event from an older reporter (no `pane`) matches by name that way. Every match binds the record to the event's session. When a matched event names another pane of the same mux, the entry's pane follows it, so `omp --resume <session>` in another pane keeps the watch (tmux only for a `%N` pane id; an entry typed as a tmux target stays as typed). A move to another mux is not followed: the probe reports `gone`, and `agent add` on the new pane re-attaches. Any other event is dropped.
- Probe. The `agent-probe` job (`inbox agent probe`) looks at every watch every 2 minutes, where it lives (one ssh call per host): the agent process in the pane (`gone` = none, only a shell left), the session jsonl (its mtime is the activity signal; `tern capture` gives nothing for omp panes), the newest `RESULT*.md` beside `--result` (its version is the first 16 hex of its sha256), and for herdr/hc the mux's own agent state.

| Record change | Row (source `agents`, place = name) | Default |
| --- | --- | --- |
| a new RESULT version | `event=result state=<status>`, key `agents:<name>:result:<version>`, note = status, `open:`, last output | `do` |
| a turn end with no new RESULT version | `event=idle state=no-result`, key `agents:<name>:<session>:idle:<n>`, note = last output; skipped when the last output equals the previous no-result row's for that session | `do` |
| -> asking | `event=ask state=<kind>`, note = question and options (tailer at once; probe on the second sighting of the same ask) | `do` |
| asking -> other | the session's live, unclaimed ask rows are archived | |
| -> gone (probe) | `event=ended state=gone`, note = RESULT status and `Resume: cd <cwd> && omp --resume <session>`, then `inbox agent add` on the new pane | `do` |
| working and quiet for `--stall-min` (30) | `event=stalled state=quiet`, once per quiet spell | `notify` |

A session keeps at most one live attention row: a new one archives the older unclaimed ones, except Wayne's question (`ask-wayne`) and the parent row of a fired, open then. `started`, `working`, `ask-resolved`, `hb` (older reporters) and `ended` events make no row; a closing entry records only a new RESULT version.

A row of a session that stopped without a new RESULT (idle, ask, blocked) closes only with a verdict: `inbox done <id> --verdict advanced|waiting-user|nothing-pending --note …` (`waiting-user` keeps it live as an `ask-wayne` row). The card says so.

Every `--digest-min` minutes (default 30) the same run also sends one progress digest to Wayne's self-chat, as `teams_send`'s progress card (`agents`): one row per watched session still running whose entry changed since the last digest sent: name, host, idle minutes, status (`working`, `waiting on question` for a blocked or idle pane or a non-done RESULT, `done`, `probe failed`), and the newest assistant text `[todo done/total, now: …]` (non-omp panes: the last pane line) behind a tap; sessions that need Wayne come first. The entry compared is the status plus `name · host · <text>` (the last-activity time does not count), so a session turning to `waiting on question` with the same text is still sent; the last entry sent is `digested` in the watch's record. A card counts as sent only on the `Sent a card to self-chat (48:notes).` receipt with the card arguments verbatim; a refused card is logged and the same digest goes out as text (`name · host · last activity HH:MM · <text>` lines). Nothing running or nothing changed → no message. The digest never writes inbox rows. A failed send (card and text both) fails the run and is retried on the next due run.

The default rules make `result`, `idle`, `ask` and `ended` rows `do`: the card starts a turn in the coordinator session. On `result`, verify the claims at the source, report in the channel `--goal` names (Teams, self-chat), then `done`. On `idle`, read the card's last output: if the job is finished, send the session one line asking for the RESULT block in the deliverable file. A question or blocker (on `ask`, in RESULT `open:`, or at the end of an idle turn) is the coordinator's first: answer it with tools when they can (read-only prod config check, repo fact, a decision Wayne already made) and send the answer into the session; ask Wayne only what needs his decision, as one concrete question in plain Chinese with what is blocked and why, 2–3 options with a recommendation, and what happens after each. `stalled` is `notify`.

## Resume after a restart

1. `/inbox watch` in the new session. Agent sessions need nothing more: the `agent-probe` job runs in whichever session holds the scheduler, the tailer resumes from `cursors/agent-events.json`, and every event written while no session delivered arrives once in the first batch.
2. Read the `teams_watch` section of `~/.wayne/inbox/rules.yaml`. For each chat call `teams_watch` with `action: start`, its `chat_id` and `policy`; pass `interval_sec` on the first call.
3. Report what is watched. Do not invent chats or policies that are not in the file.

The extension rewrites `teams_watch` on every explicit start, stop and interval change (never on session end), so the list is current. It rewrites only that section, kept last in the file; the hand-written rules above it stay byte for byte.

To restart omp itself from inside a Tern pane: a detached script sends `TERM` to the omp process, then `tern run $TERN_PANE 'omp --resume <session-id>'`, then types `/inbox watch` and a prompt asking the new session to do step 2.
