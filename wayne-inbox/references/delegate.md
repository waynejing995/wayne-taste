# Delegate a session

Load this when a card needs work beyond a read, a reply, a relay, or inbox bookkeeping. The coordinator never does that work in the main chat.

## Choose the worker

| Signal | Worker |
| --- | --- |
| One bounded check: read, verify one claim, or draft one reply | `task` subagent |
| Code, tests, investigation, a multi-step fix, or a review advisory | tern session; herdr when asked or already serving; tmux if tern is down |
| TRACE, production-adjacent data, or Artifact publishing | the TRACE host named in `~/.wayne/CONTEXT.md` |
| Everything else | the local box |

Read the source chat with `teams_read`, about 15 messages, before writing the brief. Check `inbox agent ls` and `inbox ls` for a live owner. One topic and one repository have one live owner. Hand the work to that owner instead of launching a second session.

## Write the brief

Follow `$WAYNE_SKILLS_DIR/_shared/task-prompt.md`. Copy the relevant glossary lines from `~/.wayne/CONTEXT.md` into the brief. A remote session cannot read that file.

The Context line names who asked, where the request arrived, and when, in `Asia/Shanghai`, as a quote. Inputs names the files and URLs. Report names the deliverable and the facts that must be rechecked at source.

| Work | Skill |
| --- | --- |
| Implementation | `wayne-work` |
| Review fixes | `wayne-fix-review` |
| Research | `deep-research` |
| Artifact comments | `trace-artifact-comment-loop` |
| Commit or pull request | `wayne-ship` |

Preserve uncommitted changes already in the repository. Never print a secret. Run `wayne-context-init` before launch when the task has no context file.

Before asking the coordinator, the worker checks `~/.wayne/CONTEXT.md` and its task context file. A resource it cannot reach is the coordinator's read. To ask, it writes `## Questions` in the RESULT file named by `WAYNE_AGENT_RESULT`: what is blocked, why, 2–3 options, and its recommendation. It then adds two standalone lines, each at the start of a line and containing no `|`: `status: blocked` and `open: <one-line question>`. It ends the turn. It does not wait in an interactive form, guess around the blocker, or retry a refused deploy, merge, or production write.

Check the assigned skill name on the destination host before launch. The deliverable is `<state>/runs/<topic>/RESULT.md`; resolve `<state>` with `wayne-state-dir.sh`, piped over `ssh` for a remote host.

### Publishing to a public repo

When the brief pushes to a public remote, put these in the brief as hard rules, not as after-checks:

- The wayne-ship review gate runs before the push. A skipped gate is remediated without asking again: the original push authorization covers it. Only Wayne can waive it ("不用 review，直接 push" on 2026-11-08); a waiver drops the review, never the scan below.
- The personal-info/secret scan runs BEFORE the push, unfiltered, over every outgoing commit in `origin/main..HEAD`: each diff and each message. A hit means rewriting the local unpushed history first; never rewrite what is already on origin unless Wayne asks.
- Private values go to config outside the repo (systemd drop-ins, `~/.wayne/inbox/rules.yaml`, `~/.wayne/inbox/bin/`), never into code. Missing config fails loudly at startup.
- History rewrite, only on an explicit ask: mirror backup outside the repo first, `git filter-repo` with an expressions file outside the repo, a full-history audit before and after, `--force-with-lease=main:<full current remote SHA>`, then run every live service that reads the working tree. Report residual exposure: old SHAs reachable by direct link until GitHub GC, forks (`gh api repos/<o>/<r>/forks`), and other clones. Rotate any credential that was ever public.

## Launch

Write the brief to a file first. For a remote host, run `ssh <host> mkdir -p <state>/runs/<topic>`, then `scp -q` the file there as `brief.md`. Run `export PATH=$HOME/.local/bin:$HOME/.bun/bin:$PATH` in every ssh command.

Every omp launch carries `WAYNE_AGENT_WATCH=<name>` and `WAYNE_AGENT_RESULT=<deliverable>`. Below, `ENV` means those two assignments. The watch is the omp session (host + session id); the pane is only where it runs now. The reporter runs in every root omp session in a mux pane and ignores nested `omp -p` runs and subagents, so a session launched without `ENV` can still be adopted with `agent add --result`.

| Mux | Launch | Pane id for the inbox |
| --- | --- | --- |
| tern | `tern new session <name> --cwd <dir> --keep-open -- bash -lc 'ENV omp --goal "$(cat <brief>)"; exec bash'` | the block id it prints |
| herdr | `herdr pane split --current --direction right --cwd <dir> --no-focus`, then `herdr pane run <pane> "ENV omp --goal \"\$(cat <brief>)\""` | `.result.pane.pane_id`; `herdr agent get` resolves it once omp is detected |
| tmux | `tmux new-session -d -s <name> -c <dir> "bash -lc 'ENV omp --goal \"\$(cat <brief>)\"; exec bash'"` | `<name>:1.1`; check with `tmux list-panes -t <name>` |

Never run `tern run BLOCK omp --resume …`: tern parses `--resume` as its own flag. Never run bare `herdr`: it attaches the TUI. If `herdr session list` says `stopped`, use tern or tmux instead of starting a server silently.

After about 25 seconds, confirm the agent is up: tern uses `tern process <pane>` (front process `bash -lc omp --goal …`, omp its child); herdr uses `herdr agent get <pane>`; tmux uses `pgrep -P <pane_pid> -a` and expects `omp --goal`.

## Register

```bash
"$WAYNE_SKILLS_DIR/pi-config/extensions/m365/bin/inbox" agent add <name> \
  --mux tern|herdr|tmux --pane <id> [--host <ssh host>] --result <deliverable> \
  --goal "<one line + who to report to and where>" \
  --row <live row id> --then "<expected result; how to verify it; whom to reply to, where, with what; what to close>"
```

`<name>` equals `WAYNE_AGENT_WATCH`. Register after the agent is up: `agent add` probes the pane, refuses a pane that does not exist or holds only shells, and prints what it attached to (agent pid, omp session id, phase, RESULT file/status/version, how many reporter events that session has). Read that output; it is the proof of registration. On herdr it says `agent process unknown`; the session's first event binds it.

Write the plan at dispatch. `--row` and `--then` go together; they are optional only when adopting a running session with no plan. The plan becomes a then on that row and fires on the next new RESULT version. `inbox done <row>` refuses until `inbox then-done <row> <n>`. A fired then has one live card, reminded 10 minutes, 1 hour and 4 hours after its last card, then daily. `inbox done` on a then card refuses and names the `then-done` command, which closes the then and archives its card. If no live row exists, create one with `inbox ask "<task>" --key <name>` or claim the row that asked for the work.

The watch lasts as long as the session: closing its thens never removes it. `/inbox watch` tails the reporter's events and the probe checks every watch every 2 minutes. Cards: a new RESULT version (`agent-result`), a turn end with no new RESULT (`agent-no-result`, with what the session last said), an ask (`agent-ask`), the agent process gone (`agent-ended`, with the resume line). A session keeps at most one live card. `omp --resume <session>` in another pane of the same mux keeps the watch; after a move to another mux, run `agent add` on the new pane. Do not run a private polling loop.

A no-result, ask or blocked card means the session stopped without a new RESULT. Read what it last said, then advance it yourself (a decision Wayne already made; a recommended option with no prod write, merge, deploy or spend; a question a tool can answer) or leave it to Wayne. Its row closes only with a verdict: `inbox done <id> --verdict advanced|waiting-user|nothing-pending --note "<what you did / the question / why nothing is owed>"`; `waiting-user` keeps it live as an `ask-wayne` row.

Answer an agent question yourself when a read can settle it, then send the answer into the session. Ask Wayne only for a decision: one concrete Chinese question, with the blocker, why, and 2–3 options. Close a fulfilled then-action with `inbox then-done`.

## Follow up and verify

Send a follow-up with `tern send` (paste plus Enter), `herdr agent prompt`, or `tmux load-buffer` and `paste-buffer`. Confirm that the session received it.

The watch stays after a done RESULT, so a follow-up round needs no new `agent add`: the next RESULT version (a new content hash of the newest `RESULT*.md` in the run directory) makes one new card. Run `agent add` again only to give the watch a new plan (`--row`/`--then`; it closes the name's previous unfired plan) or to point it at a pane in another mux. Move the verified file to `RESULT-round<N>.md` before the next round.

The RESULT is a claim. Recheck its mtime, reject placeholders (`__[A-Z]`, `JOINT_`, `_LINE`, `TODO`), and recheck its facts at source with `gh pr view` or the named system. A claimed Teams post needs its receipt.

Only after `status: done`, run one retro round in the same session. Send: "Run `wayne-compress` on this job, unattended: candidates only, apply nothing. Write a fresh RESULT.md: `status: done`, `## Retro` with the candidates worst first, each with its session moment and the file it would change, or `none`. The previous RESULT is at RESULT-round<N>.md." Relay the candidates to Wayne as a short Chinese table and ask which to apply. Applying one is a new job. Skip retro for `partial`, `blocked`, and one-shot `task` subagents.

Report one short message in the request channel: session, machine, mux, pane, cwd, ask, limits, deliverable path, and that it is registered. After verification, close the row with `inbox done --note`.

## Close

`inbox agent close <name>` prints liveness, phase, idle time, the RESULT status/open/verified lines, the RESULT version and open thens, and closes nothing. Verify the RESULT at its source, then run `inbox agent close <name> --ack <version|none> --note "<what you verified>"`. It refuses while the session is working or asking, while a fired then is open, or when the RESULT changed since you read it. A gone session's watch is removed at once; a live idle one becomes `closing`. Only then kill the pane: `tern kill`, `tmux kill-*` and `herdr pane close` on a watched pane are blocked until the close is acknowledged. The probe removes the watch once the pane is gone.
