# Delegate a session

Load this when a card needs work beyond a read, a reply, a relay, or inbox bookkeeping. The coordinator never does that work in the main chat.

## Choose the worker

| Signal | Worker |
| --- | --- |
| One bounded check: read, verify one claim, or draft one reply | `task` subagent |
| Code, tests, investigation, a multi-step fix, or a review advisory | tern session; herdr when asked or already serving; tmux if tern is down |
| TRACE, production-adjacent data, or Artifact publishing | the TRACE host named in `~/.wayne/CONTEXT.md` |
| Everything else | the local box |

For a Teams-origin card, read the source chat with `teams_read`, about 15 messages, before writing the brief; otherwise read the card's own source record/PR/mail first. Check `inbox agent ls` and `inbox ls` for a live owner. One topic and one repository have one live owner. Hand the work to that owner instead of launching a second session.

## Write the brief

Follow `$WAYNE_SKILLS_DIR/_shared/task-prompt.md`. Copy the relevant glossary lines from `~/.wayne/CONTEXT.md` into the brief. A remote session cannot read that file.
When `<state>/context.md` exists on the destination host, include its path in `Context:` and instruct the worker to read it first before touching the repo or remotes.
When a target repository maintains an in-repo glossary (e.g. `docs/current_status/glossary.md` kept current by a commit hook), point the brief at that file on `origin/main` for product terminology, while `~/.wayne/CONTEXT.md` supplies Wayne's dev-env/host/cross-repo specifics.

Start every brief with the `Pain:` section in [_shared/task-prompt.md](../../_shared/task-prompt.md#sections) before stating the goal or ask; put who asked, where, and when (`Asia/Shanghai`) as a quote in `Pain:`. `Inputs` names the files and URLs; `Report` names the deliverable and the facts that must be rechecked at source.

For any task changing user-facing UI, interaction, or copy, include the [UI flow](../../_shared/task-prompt.md#ui-flow) in `Tasks:` and require its comparison table and review resolutions in RESULT.

Execution subagents (in every brief and in coordinator `task` calls) use the default/`task` model. The only exception is the Gemini design and review steps of the UI flow, which use the exact Gemini selector given there. An execution subagent never picks or switches to Opus unless Wayne explicitly authorizes it; if a model fails, report and ask, and do not justify an upgrade. Review agents (the code-review, plan, and spec review voices) keep their own configured model, even when it resolves to Opus.

| Work                                         | Skill                         |
| -------------------------------------------- | ----------------------------- |
| New medium or large task: design, then build | `wayne-auto-design-task`      |
| Urgent production hotfix (root cause known)  | fast `wayne-plan` (lite) + `wayne-work` (skip dual-proposal design) |
| Implementation of an approved plan           | `wayne-work`                  |
| Review fixes                                 | `wayne-fix-review`            |
| Research                                     | `deep-research`               |
| Artifact comments                            | `trace-artifact-comment-loop` |
| Commit or pull request                       | `wayne-ship`                  |

Preserve uncommitted changes already in the repository. Never print a secret. Run `wayne-context-init` before launch when the task has no context file.

Before asking the coordinator, the worker checks `~/.wayne/CONTEXT.md` and its task context file. A resource it cannot reach is the coordinator's read. To ask, it writes `## Questions` in the RESULT file named by `WAYNE_AGENT_RESULT`: what is blocked, why, 2–3 options, and its recommendation. It then adds two standalone lines, each at the start of a line and containing no `|`: `status: blocked` and `open: <one-line question>`. It ends the turn. It does not wait in an interactive form, guess around the blocker, or retry a refused deploy, merge, or production write.

Check the assigned skill name on the destination host before launch. The deliverable is `<state>/runs/<topic>/RESULT.md`; resolve `<state>` with `wayne-state-dir.sh <repo-dir>`, piped over `ssh` with `<repo-dir>` as its argument for a remote host (stop if it fails).

### Publishing to a public repo

When the brief pushes to a public remote, put these in the brief as hard rules, not as after-checks:

- The wayne-ship review gate runs before the push. A skipped gate is remediated without asking again: the original push authorization covers it. Only Wayne can waive it ("不用 review，直接 push" on 2026-11-08); a waiver drops the review, never the scan below.
- The personal-info/secret scan runs BEFORE the push, unfiltered, over every commit newly reachable on the target push destination (verify the remote tip first; e.g., `<public-remote>/<branch>..HEAD`, `origin/main..HEAD` when `origin` is the public repo, or all outgoing commits from root if the target branch/remote has no tip yet—stop if remote state cannot be verified): full commit metadata (author/committer), message, and diff. A hit means rewriting the local unpushed history first; never rewrite what is already on the remote unless Wayne asks.
- Private values go to config outside the repo (systemd drop-ins, `~/.wayne/inbox/rules.yaml`, `~/.wayne/inbox/bin/`), never into code. Missing config fails loudly at startup.
- History rewrite, only on an explicit ask: mirror backup outside the repo first, `git filter-repo` with an expressions file outside the repo, a full-history audit before and after, `--force-with-lease=main:<full current remote SHA>`, then run every live service that reads the working tree. Report residual exposure: old SHAs reachable by direct link until GitHub GC, forks (`gh api repos/<o>/<r>/forks`), and other clones. Rotate any credential that was ever public.

## Launch

Write the brief to a file first. For a remote host, run `ssh <host> mkdir -p <state>/runs/<topic>`, then `scp -q` the file there as `brief.md`. Run `export PATH=$HOME/.local/bin:$HOME/.bun/bin:$PATH` in every ssh command.

Every new task gets its own new worktree, and the session starts there. Never launch it in a shared repository root (the repository's main checkout): that root holds other branches and Wayne's uncommitted work, and omp's `isolated` subagents build their worktrees from the session directory and apply back into it, so a shared root makes `wayne-work` fall back to serial units. Create it on the task's host with `omp worktree add -C <repo> -b <task-branch> ~/checkouts/<topic> <base-ref>` (the base is the PR's target branch, fetched first). Where `~/checkouts` is an ovnfs mount (`mount | grep checkouts` shows `fuse.ovnfs`), `omp worktree add` cannot write there: run `ovnfs new --name <topic> --rev <base-ref>` from the repository, then `git switch -c <task-branch>` inside the printed path. Also use `ovnfs new` (without `--rev`) when the task must start from uncommitted state. A follow-up on an existing PR reuses that PR's worktree. Pass the worktree path as `<dir>` below.

Every omp launch carries `WAYNE_AGENT_WATCH=<name>` and `WAYNE_AGENT_RESULT=<deliverable>`. Below, `ENV` means those two assignments. The watch is the omp session (host + session id); the pane is only where it runs now. The reporter runs in every root omp session in a mux pane and ignores nested `omp -p` runs and subagents, so a session launched without `ENV` can still be adopted with `agent add --result`.

| Mux | Launch | Pane id for the inbox |
| --- | --- | --- |
| tern | `tern new session <name> --cwd <dir> --keep-open -- bash -lc 'ENV omp --goal "$(cat <brief>)"; exec bash'` | the block id it prints |
| herdr | `herdr pane split --current --direction right --cwd <dir> --no-focus`, then `herdr pane run <pane> "ENV omp --goal \"\$(cat <brief>)\""` | `.result.pane.pane_id`; `herdr agent get` resolves it once omp is detected |
| tmux | `tmux new-session -d -s <name> -c <dir> "bash -lc 'ENV omp --goal \"\$(cat <brief>)\"; exec bash'"` | `tmux list-panes -t <name> -F '#{pane_id}'` (`%N` id so pane moves follow) |

Never run `tern run BLOCK omp --resume …`: tern parses `--resume` as its own flag. Never run bare `herdr`: it attaches the TUI. If `herdr session list` says `stopped`, use tern or tmux instead of starting a server silently.

After about 25 seconds, confirm the agent is up: tern uses `tern process <pane>` (front process `bash -lc omp --goal …`, omp its child); herdr uses `herdr agent get <pane>`; tmux uses `pgrep -P <pane_pid> -a` and expects `omp --goal`.

## Register

```bash
"$WAYNE_SKILLS_DIR/pi-config/extensions/m365/bin/inbox" agent add <name> \
  --mux tern|herdr|tmux --pane <id> [--host <ssh host>] --result <deliverable> \
  --goal "<one line + who to report to and where>" \
  --row <live row id> --then "<expected result; how to verify it; whom to reply to, where, with what; what to close>"
```

`<name>` equals `WAYNE_AGENT_WATCH`. Register after the agent is up: `agent add` probes the pane, refuses a pane that does not exist or holds only shells, and prints what it attached to (agent pid, omp session id, phase, RESULT file/status/version, how many reporter events that session has). Read that output; it is the proof of registration. If `agent add` already prints a `RESULT ... version`, that version is the armed `then`'s baseline (it fires only on a newer version), so handle that existing RESULT now. On herdr it says `agent process unknown`; when launched with `WAYNE_AGENT_WATCH=<name>`, the session's first event binds it (without `ENV`, herdr watches are probe-only until a session identity is bound).

Write the plan at dispatch. `--row` and `--then` go together; they are optional only when adopting a running session with no plan. The plan becomes a then on that row and fires on the next new RESULT version. Only fired, open `then`s block `inbox done <row>` (`inbox then-done <row> <n>` closes one); keep the row claimed while its `then` is still pending. A fired then has one live card, reminded 10 minutes, 1 hour and 4 hours after its last card, then daily. `inbox done` on a then card refuses and names the `then-done` command, which closes the then and archives its card. If no live row exists, create one with `inbox ask "<task>" --key <unique-task-key>` (and verify the returned row is live) or claim the row that asked for the work.

The watch lasts as long as the session: closing its thens never removes it. `/inbox watch` tails the reporter's events and the probe checks every watch every 2 minutes. Cards: a new RESULT version (`agent-result`), a turn end with no new RESULT (`agent-no-result`, with what the session last said), an ask (`agent-ask`), the agent process gone (`agent-ended`, with the resume line). A session keeps at most one live card. `omp --resume <session>` in another pane of the same mux keeps the watch; after a move to another mux, run `agent add` on the new pane. Do not run a private polling loop.

A no-result, ask or blocked card means the session stopped without a new RESULT (`agent-no-result` / `agent-ask`). Read what it last said, then advance it yourself (only when within existing authorization and the brief's limits: a decision Wayne already made; a recommended option with no prod write, merge, deploy or spend; a question a tool can answer) or leave it to Wayne. Its row closes only with a verdict: `inbox done <id> --verdict advanced|waiting-user|nothing-pending --note "<what you did / the question / why nothing is owed>"`; `waiting-user` keeps it live as an `ask-wayne` row. A `RESULT` with `status: blocked` produces an `agent-result` row instead (not handled by `--verdict`) and fires any armed `agent-result` `then` on that watch; after resolving the blocker (opening an `ask-wayne` row with `inbox ask` if it waits on Wayne), close the fired `then` with `inbox then-done`, re-arm the completion plan on the live task row before resuming the worker, and close the `agent-result` row.

Answer an agent question yourself when a read can settle it, then send the answer into the session. Ask Wayne only for a decision: one concrete Chinese question, with the blocker, why, and 2–3 options. Close a fulfilled then-action with `inbox then-done`.
**Check direct user replies before asking Wayne:** Wayne sometimes answers a watched session directly in its pane (in addition to messages sent by the coordinator). Before re-asking Wayne about a session's open question or closing a question as unanswered, inspect all `role: "user"` messages in that session's `.jsonl` since the last check (distinguishing coordinator-prefixed messages from Wayne's direct input). If Wayne already answered there, close the coordinator ask row and do not ask him again.

## Follow up and verify

Send a follow-up with `tern send <pane> paste` (pass literal text from a file or stdin/single-quoted heredoc without shell interpolation of untrusted text) followed by `tern send <pane> keys Return`, `herdr agent prompt`, or `tmux load-buffer -b <unique-buf> <file>`, `paste-buffer -dpr -b <unique-buf> -t <pane>`, and `send-keys -t <pane> C-m` (after verifying the session is still in `<pane>`). After `tern send <pane> paste` + `tern send <pane> keys Return`, grep `tern capture <pane> --surfaces --scrollback` for a unique phrase from the message to confirm it landed; a busy session queues it—re-check after its turn ends before resending, because resending delivers twice. Never push a new process rule into a running session; put process changes in the next session's brief instead.

When you relay review findings (an auto-review comment, inline review comments, or a reviewer's report) into a session, the follow-up itself must say: the session's main model first writes its fix approach or plan for each finding (root cause, what changes in which files, and the test that proves it), and only then hands the work to subagents. A subagent never receives a raw review comment as its task. This instruction is part of the relayed task, so it is not a new process rule in the sense of the paragraph above. The coordinator has already triaged the relayed findings, so the session does not stop for Wayne to select findings or approve the plan: it plans, then dispatches through its own build path (`wayne-work` units when it has an approved plan). Invoke `wayne-fix-review` only when Wayne himself asks for a review round to be addressed.

The watch stays after a done RESULT, so a follow-up round needs no new `agent add`: the next RESULT version (a new content hash of the newest `RESULT*.md` in the run directory) makes one new card. Run `agent add` again only to give the watch a new plan (`--row`/`--then`; it closes the name's previous unfired plan) or to point it at a pane in another mux. Move the verified file to `RESULT-round<N>.md` before the next round.

The RESULT is a claim. Recheck its mtime, reject placeholders (`__[A-Z]`, `JOINT_`, `_LINE`, `TODO`), and recheck its facts at source with `gh pr view` or the named system. A claimed Teams post needs its receipt.

Only after `status: done` (and not for a `## Retro` result itself), run one retro round in the same session. Send: "Run `wayne-compress` on this job, unattended: candidates only, apply nothing. Write a fresh RESULT.md: `status: done`, `## Retro` with at most the **top 3** costliest candidates worst first, each with its session moment and the file it would change, or `none`. The previous RESULT is at RESULT-round<N>.md." Do NOT interrupt Wayne after every session for routine candidates: record them (de-duplicated across sessions) into `~/.wayne/inbox/retro-queue.md`, escalate immediately only for high-risk or data-destructive findings, and send one consolidated Chinese summary table to Wayne's Teams self-chat every day at **17:00** (driven by the `retro-daily-digest` schedule) asking which to apply. Applying one is a new job. Skip retro for `partial`, `blocked`, and one-shot `task` subagents.

Report one short message in the request channel: session, machine, mux, pane, cwd, ask, limits, deliverable path, and that it is registered. After verification, close the row with `inbox done --note`.

## Close

When every PR a watched session owns is merged (or a read-only / no-PR session writes its retro RESULT and its candidates are queued in `~/.wayne/inbox/retro-queue.md`), close and clean up the session without waiting for the 17:00 digest pick:

1. **No remaining work:** check `rules.yaml` for any other open PRs that session still owns, and confirm its retro round has run (or was skipped per above).
2. **Teardown before killing the pane** (ask the session to run its own teardown while still live, or run it on the session's host after confirming nothing else uses it):
   - Stop and remove any isolated Docker containers, demo stacks, dev servers, or background services this session started (`docker rm -f <prefix>-*`, stop supervised services, verify `ss -ltn` no longer listens on its ports).
   - Remove its scratch `/tmp/<prefix>-*` dirs, env files (which may hold secrets), and any throwaway DBs/schemas it created. Never touch shared DBs or another session's containers.
   - Prune `<state>/runs/<topic>/context.md` per `wayne-compress` §P (promote durable lines to `<state>/context.md`, delete task-local lines; keep `RESULT*.md` as the run record).
3. **Acknowledge close and kill the pane:** run `inbox agent close <name>` first (it prints liveness, phase, idle time, RESULT status/open/verified, version, and open thens, and closes nothing). Verify the RESULT at its source, then run `inbox agent close <name> --ack <version|none> --note "<what you verified and cleaned>"`. It refuses while the session is working or asking, while a fired then is open, or when the RESULT changed since you read it; if a session stays `working` with no output for hours, report it to Wayne and do not force it. A gone session's watch is removed at once; a live idle one becomes `closing`. Only then kill the pane (`tern kill`, `tmux kill-*`, or `herdr pane close` — blocked until close is acknowledged). The probe removes the watch once the pane is gone.
4. **Remove the checkout:** once the pane is gone and every commit from that checkout is merged or discarded, remove the task checkout (`ovnfs rm <name>` for ovnfs checkouts, or `git worktree remove <path>` for git worktrees). Report what was cleaned (containers, `/tmp`, checkout, pane) in the close note.
