#!/usr/bin/env python3
# /// script
# requires-python = ">=3.11"
# dependencies = ["pyyaml", "click", "loguru"]
# ///
"""Watch the agent sessions listed under `agent_watch` in rules.yaml and feed what changed into the inbox.

Each run looks at three things per session, nothing in between:
  - the start: is the pane (and the agent in it) still there;
  - the end:   has the deliverable file got its RESULT block, and with which status;
  - the middle: is it still producing output. omp: the age of its session jsonl. herdr / hc: the agent state
    they report. tmux / anything else: whether the pane's text changed since the last run. An agent waiting for its
    next prompt (omp: last message a finished assistant turn; herdr / hc: idle/done) is idle, never stalled;
    idle with no RESULT means it ended its turn without writing one (forgot, or asked a question in prose).

Events (source `agents`, place = the session name; rules.yaml usually covers them with the `"*"` place):
  event=result  state=done|partial|blocked   once per RESULT (keyed by the file's mtime)
  event=gone    state=exited                 the pane or agent ended with no RESULT
  event=stalled state=quiet                  no output for --stall-min minutes; once per quiet spell
  event=blocked state=waiting                herdr or hc says the agent waits, or an omp session's last message is a pending ask tool call
  event=idle    state=no-result              the agent ended its turn but the RESULT file has no status line;
                                             once per idle spell

A session whose RESULT says `done` is taken off the list once its event is recorded; others stay until
`inbox.py agent rm`. Run state (last activity, open quiet spell, pane text hash) is in
cursors/agent-watch.json, never in rules.yaml.
Entries with push: true are not probed for events (the m365 inbox extension receives their pushed events); they only get a digest line.

Progress digest (every `--digest-min` minutes, default 30): one message to Wayne's self-chat lists each running
session with its newest assistant text (omp: from its session jsonl; other panes: the last pane line) and, for omp,
its todo progress. It is not an inbox row and never calls inbox.py. A session whose line (without its `last activity`
time) is the one it had in the last digest sent is left out; nothing new anywhere sends nothing. The last digest time
is `_digest` and each session's last sent line is its `digested` in cursors/agent-watch.json; a failed send is logged,
exits 1, and leaves both as they were.

Usage: watch-agents.py [--stall-min 30] [--digest-min 30]   (a systemd user timer runs it every 2 minutes)
"""

from __future__ import annotations

import base64
import gzip
import hashlib
import json
import os
import re
import shlex
import subprocess
import sys
import tempfile
import time
from datetime import datetime
from pathlib import Path

import click
import yaml
from loguru import logger

HOME = Path(os.environ.get("WAYNE_INBOX_DIR", Path.home() / ".wayne" / "inbox"))
RULES = HOME / "rules.yaml"
STATE = HOME / "cursors" / "agent-watch.json"
INBOX = [sys.executable, str(Path(__file__).with_name("inbox.py"))]
EMPTY = hashlib.md5(b"").hexdigest()[:16]
DIGEST = "_digest"  # reserved STATE key: when the last progress digest went out
SELF_RECEIPT = "Sent to self-chat (48:notes)."
CLIP = 300

# One probe per session, run where the pane lives. Prints one JSON object. The paths after it are
# the only inputs; it never writes. `$HOME/.local/bin` and `$HOME/.bun/bin` hold tern and omp on Wayne's hosts.
# `want=1` adds `kind` and `tail` (gzip, base64 -w0): from the whole omp session, its newest assistant lines that carry
# text and its newest todo result (a long tool-only run cannot push them out), else the pane text. Only the progress
# digest asks for it; without it the output is exactly what it was.
PROBE = r"""
export PATH="$HOME/.local/bin:$HOME/.bun/bin:$PATH"
mux=$1 pane=$2 result=$3 want=$4
# `cap` is the one capture per run. `printf x` keeps its trailing newlines, so the hash matches the old pipe.
alive=false agent= state= session= text= cap=
case $mux in
tern)
  info=$(tern process "$pane" --json 2>/dev/null) && alive=true
  pid=$(printf '%s' "$info" | sed -n 's/.*"foreground": *{ *"pid": *\([0-9]*\).*/\1/p' | head -1)
  [ -z "$pid" ] && pid=$(printf '%s' "$info" | tr -d '\n' | sed -n 's/.*"foreground": *{[^}]*"pid": *\([0-9]*\).*/\1/p')
  # `bash -lc "omp …"` (how goal sessions are launched) leaves bash in front and omp as its child.
  for p in $pid $(pgrep -P "$pid" 2>/dev/null); do
    s=$(ls -l /proc/$p/fd 2>/dev/null | grep -oE '/[^ ]*/sessions/[^/ ]+/[^/ ]+\.jsonl$' | head -1)
    if [ -n "$s" ]; then session=$s agent=$(cat /proc/$p/comm 2>/dev/null); break; fi
    [ -z "$agent" ] && agent=$(cat /proc/$p/comm 2>/dev/null)
  done
  cap=$(tern capture "$pane" 2>/dev/null; printf x); cap=${cap%x}
  text=$(printf '%s' "$cap" | md5sum | cut -c1-16) ;;
herdr)
  info=$(herdr agent get "$pane" 2>/dev/null) && alive=true
  state=$(printf '%s' "$info" | tr -d '\n' | sed -n 's/.*"agent_status": *"\([a-z]*\)".*/\1/p')
  cap=$(herdr agent read "$pane" 2>/dev/null; printf x); cap=${cap%x}
  text=$(printf '%s' "$cap" | md5sum | cut -c1-16) ;;
hc)
  # `hc get` exits non-zero for an unknown terminal; a finished one stays listed with state != live.
  info=$(hc get "$pane" 2>/dev/null) && printf '%s' "$info" | tr -d '\n' | grep -q '"state": *"live"' && alive=true
  state=$(printf '%s' "$info" | tr -d '\n' | sed -n 's/.*"status": *{[^}]*"state": *"\([a-z]*\)".*/\1/p')
  # hc's blocked = waiting on a question; working/done map onto herdr's working/idle.
  [ "$state" = done ] && state=idle
  cap=$(hc read "$pane" 2>/dev/null | tail -c 20000; printf x); cap=${cap%x}
  text=$(printf '%s' "$cap" | md5sum | cut -c1-16) ;;
tmux)
  tmux display-message -p -t "$pane" '#{pane_dead}' 2>/dev/null | grep -qx 0 && alive=true
  agent=$(tmux display-message -p -t "$pane" '#{pane_current_command}' 2>/dev/null)
  cap=$(tmux capture-pane -p -t "$pane" 2>/dev/null; printf x); cap=${cap%x}
  text=$(printf '%s' "$cap" | md5sum | cut -c1-16) ;;
esac
smtime=0 waiting=false
if [ -n "$session" ]; then
  smtime=$(stat -c %Y "$session" 2>/dev/null || echo 0)
  # omp waits for input when its last message is an assistant turn that ended (not a tool call).
  last=$(tail -c 200000 "$session" | grep '"message":{"role":"' | tail -1)
  case $last in
    *'"role":"assistant"'*)
      case $last in
        *'"stopReason":"toolUse"'*) case $last in *'"name":"ask","arguments":'*) [ -z "$state" ] && state=blocked ;; esac ;;
        *'"stopReason":"'*) waiting=true ;;
      esac ;;
  esac
fi
rmtime=0 rstatus=
if [ -n "$result" ] && [ -f "$result" ]; then
  rmtime=$(stat -c %Y "$result")
  # A line holding `|` is the contract's own template (`status: done | partial | blocked`), never a status.
  rstatus=$(sed -n '/|/!s/^ *\([-*] \)\?\(\*\*status\(\*\*:\?\|:\*\*\)\|`status`:\|`status:`\|status:\) *\([a-z_][a-z_]*\).*/\4/p' "$result" | tail -1)
fi
extra=
if [ "$want" = 1 ]; then
  if [ -n "$session" ]; then
    kind=jsonl
    # JSON escapes quotes inside strings, so a bare `"type":"text"` is a real content item, never quoted text.
    tail64=$( { grep -F '"message":{"role":"assistant"' "$session" | grep -F '"type":"text"' | tail -n 20
                grep -F '"message":{"role":"toolResult"' "$session" | grep -F '"toolName":"todo"' | tail -n 1; } | gzip -c | base64 -w0)
  else kind=pane; tail64=$(printf '%s' "$cap" | gzip -c | base64 -w0); fi
  extra=",\"kind\":\"$kind\",\"tail\":\"$tail64\""
fi
printf '{"alive":%s,"agent":"%s","state":"%s","session":"%s","smtime":%s,"waiting":%s,"text":"%s","rmtime":%s,"rstatus":"%s","now":%s%s}\n' \
  "$alive" "$agent" "$state" "$session" "$smtime" "$waiting" "$text" "$rmtime" "$rstatus" "$(date +%s)" "$extra"
"""


def probe(a: dict, want: bool = False) -> dict:
    """Run PROBE where the pane lives. A failed ssh is an error, not a dead pane. `want` asks for the text tail."""
    local = a.get("host", "local") == "local"
    args = [a["mux"], str(a["pane"]), os.path.expanduser(a.get("result", "")) if local else a.get("result", ""),
            "1" if want else ""]
    if local:
        cmd = ["bash", "-c", PROBE, "probe", *args]
    else:
        remote = "bash -c " + shlex.quote(PROBE) + " probe " + " ".join(shlex.quote(x) for x in args)
        cmd = ["ssh", "-o", "BatchMode=yes", "-o", "ConnectTimeout=10", a["host"], remote]
    try:
        r = subprocess.run(cmd, capture_output=True, text=True, timeout=60)
    except subprocess.TimeoutExpired:
        raise RuntimeError(f"probe on {a.get('host', 'local')} timed out after 60 s") from None
    line = r.stdout.strip().splitlines()[-1] if r.stdout.strip() else ""
    if r.returncode != 0 or not line.startswith("{"):
        raise RuntimeError(f"probe on {a.get('host', 'local')} failed (exit {r.returncode}): {r.stderr.strip()[:200]}")
    return json.loads(line)


def one_line(text: str) -> str:
    """Whitespace collapsed to single spaces, the newest CLIP characters, with a leading … when cut."""
    text = " ".join(text.split())
    return text if len(text) <= CLIP else "\u2026" + text[-(CLIP - 1):]


def latest_line(jsonl_text: str) -> str:
    """The newest assistant text in an omp session tail, then the latest todo state. Lines that do not parse (a cut's head) are skipped."""
    msgs = []
    for raw in jsonl_text.splitlines():
        try:
            msg = json.loads(raw).get("message")
        except (json.JSONDecodeError, AttributeError):
            continue
        if isinstance(msg, dict):
            msgs.append(msg)
    text = ""
    for msg in reversed(msgs):
        if msg.get("role") != "assistant":
            continue
        texts = [item.get("text", "") for item in msg.get("content") or [] if isinstance(item, dict) and item.get("type") == "text"]
        text = " ".join(t for t in texts if t.strip())
        if text:
            break
    todo = next((msg for msg in reversed(msgs) if msg.get("role") == "toolResult" and msg.get("toolName") == "todo"), None)
    out = one_line(text) if text else "no text"
    if todo is not None:
        tasks = [task for phase in (todo.get("details") or {}).get("phases") or [] for task in phase.get("tasks") or []]
        done = sum(task.get("status") == "completed" for task in tasks)
        now = next((task.get("content", "") for task in tasks if task.get("status") == "in_progress"), None)
        out += f" [todo {done}/{len(tasks)}" + (f", now: {one_line(now)}]" if now else "]")
    return out


def pane_line(text: str) -> str:
    """The last non-empty line of a pane capture, or `no text`."""
    lines = [line for line in text.splitlines() if line.strip()]
    return one_line(lines[-1]) if lines else "no text"


def add(a: dict, key: str, event: str, state: str, note: str) -> str:
    """One `inbox.py add`; its failure stops the run so nothing is marked as reported that was not."""
    name = a["name"]
    if a.get("goal"):
        note = f"{note}. Goal: {a['goal']}"
    cmd = [*INBOX, "add", "--source", "agents", "--place", name, "--key", f"agents:{name}:{key}",
           "--subject", f"agent {name}", "--note", note, "--link", a.get("result", ""),
           "--field", f"event={event}", "--field", f"state={state}", "--field", f"mux={a['mux']}", "--field", f"host={a.get('host', 'local')}"]
    r = subprocess.run(cmd, capture_output=True, text=True)
    if r.returncode != 0:
        raise RuntimeError(f"inbox.py add failed: {r.stderr.strip()}")
    return r.stdout.strip()


def session_entry(a: dict, st: dict, p: dict) -> str:
    """One digest line for a running session, from the probe's tail. The tail may start mid-line; latest_line skips that."""
    text = gzip.decompress(base64.b64decode(p["tail"])).decode(errors="replace")
    latest = latest_line(text) if p["kind"] == "jsonl" else pane_line(text)
    when = datetime.fromtimestamp(st["last_active"]).strftime("%H:%M")
    return f"- {a['name']} \u00b7 {a.get('host', 'local')} \u00b7 last activity {when} \u00b7 {latest}"


def receipt_text(event: dict) -> str:
    content = (event.get("result") or {}).get("content") or []
    return "".join(item.get("text", "") for item in content if isinstance(item, dict))


def verify_digest(stdout: str, digest: str) -> str:
    """The digest counts as sent only if omp's own stream shows one successful self-chat teams_send carrying it verbatim."""
    events = []
    for line in stdout.splitlines():
        try:
            events.append(json.loads(line))
        except json.JSONDecodeError:
            continue
    ends = [event for event in events if event.get("type") == "tool_execution_end" and event.get("toolName") == "teams_send"]
    if len(ends) != 1:
        raise RuntimeError(f"teams_send calls: {len(ends)}; expected exactly one")
    end = ends[0]
    text = receipt_text(end)
    if end.get("isError") is True:
        raise RuntimeError(f"teams_send tool error: {text or 'unknown'}")
    if not text.startswith(SELF_RECEIPT):
        raise RuntimeError(f"teams_send receipt is not the self-chat receipt: {text or '(empty)'}")
    starts = [event for event in events if event.get("type") == "tool_execution_start"
              and event.get("toolCallId") == end.get("toolCallId")]
    args = starts[0].get("args") if starts and isinstance(starts[0].get("args"), dict) else {}
    if str(args.get("message", "")).strip() != digest.strip():
        raise RuntimeError("teams_send message differs from the digest")
    if args.get("target") != "self":
        raise RuntimeError(f"teams_send target is {args.get('target')!r}, expected self")
    return text


def post_digest(digest: str) -> str:
    """Send the digest to Wayne's self-chat through omp's teams_send: trace-monitor's self path, copied, with the digest verbatim."""
    prompt = (Path(__file__).with_name("trace-monitor.prompt.md").read_text()
              .replace("{{DESTINATION}}", "`target: self`").replace("{{DIGEST}}", digest))
    command = ["omp", "-p", "--mode", "json", "--no-session", "--no-title", "--max-time", "10m",
               "--tools", "teams_send", prompt]
    try:
        with tempfile.TemporaryDirectory() as tmp:
            result = subprocess.run(command, capture_output=True, text=True, cwd=tmp)
    except OSError as exc:
        raise RuntimeError(f"omp not run: {exc}") from exc
    if result.returncode != 0:
        raise RuntimeError(f"omp exited {result.returncode}: {result.stderr.strip()[-200:]}")
    return verify_digest(result.stdout, digest)


def check(a: dict, st: dict, stall_s: int, want: bool) -> tuple[list[tuple[str, str, str, str]], dict]:
    """The events this run owes for one session: (key, event, state, note), and the probe. Updates `st` in place."""
    p = probe(a, want=want)
    now = p["now"]
    events = []
    # The middle: any sign of output moves last_active.
    active = p["smtime"] if p["smtime"] else 0
    # An empty capture (omp panes in tern give none) hashes the same every time and says nothing.
    if p["text"] and p["text"] != EMPTY and p["text"] != st.get("text"):
        active = max(active, now)
        st["text"] = p["text"]
    if p["state"] == "working":
        active = max(active, now)
    st["last_active"] = max(st.get("last_active", now), active)
    # The end.
    if p["rmtime"] and p["rstatus"]:
        events.append((f"result:{p['rmtime']}", "result", p["rstatus"], f"RESULT status: {p['rstatus']}"))
    # The start.
    elif not p["alive"]:
        events.append(("gone", "gone", "exited", "the pane ended with no RESULT"))
    elif p["state"] == "blocked":
        events.append((f"blocked:{st['last_active']}", "blocked", "waiting", f"{a['mux']}: waiting on an approval or a question"))
    quiet = now - st["last_active"]
    # An agent waiting for its next prompt is idle, not stalled.
    if p["state"] in ("idle", "done"):
        p["waiting"] = True
    if p["alive"] and not p["rstatus"] and p["state"] != "blocked" and not p["waiting"] and quiet >= stall_s:
        # One event per quiet spell: the spell is named by when it began.
        events.append((f"stalled:{st['last_active']}", "stalled", "quiet", f"no output for {quiet // 60} min"))
    if p["alive"] and not p["rstatus"] and p["state"] != "blocked" and p["waiting"]:
        # Named by the last activity, so a session nudged into working again can go idle (and be reported) again.
        events.append((f"idle:{st['last_active']}", "idle", "no-result", "turn ended with no RESULT block"))
    st["last_seen"] = now
    st["alive"] = p["alive"]
    return events, p


def digest_probe(a: dict, st: dict) -> str | None:
    """Probe a push session only for its digest line, without producing events."""
    p = probe(a, want=True)
    st["last_active"] = max(st.get("last_active", 0), p["smtime"] or 0) or p["now"]
    st["last_seen"] = p["now"]
    return session_entry(a, st, p) if p["alive"] else None


def unchanged(line: str) -> str:
    """What a digest line says, minus its `last activity` time: the part compared with the last digest sent."""
    return re.sub(r" \u00b7 last activity \d\d:\d\d", "", line)


@click.command()
@click.option("--stall-min", default=30, show_default=True, help="minutes without output before a session counts as stalled")
@click.option("--digest-min", default=30, show_default=True, help="minutes between progress digests to Wayne's self-chat; 0 sends one this run")
@click.option("-v", "--verbose", is_flag=True)
def main(stall_min: int, digest_min: int, verbose: bool) -> None:
    logger.remove()
    logger.add(sys.stderr, level="DEBUG" if verbose else "INFO")
    agents = ((yaml.safe_load(RULES.read_text()) if RULES.exists() else None) or {}).get("agent_watch") or []
    state = json.loads(STATE.read_text()) if STATE.exists() else {}
    now = int(time.time())
    digest_last = state.get(DIGEST, {}).get("at")
    digest_due = digest_last is None or now - digest_last >= digest_min * 60
    finished = []
    lines = []
    failed = 0
    for a in agents:
        st = state.setdefault(a["name"], {})
        try:
            if a.get("push"):
                if digest_due:
                    line = digest_probe(a, st)
                    if line:
                        lines.append((a["name"], line))
                continue
            events, p = check(a, st, stall_min * 60, want=digest_due)
        except Exception as e:  # one session's failure must not hide the others'
            failed += 1
            logger.error("{}: {}", a["name"], e)
            if digest_due:
                lines.append((a["name"], f"- {a['name']} \u00b7 {a.get('host', 'local')} \u00b7 probe failed: {str(e)[:200]}"))
            continue
        if digest_due and p["alive"] and not any(event == "result" and s == "done" for _, event, s, _ in events):
            try:
                lines.append((a["name"], session_entry(a, st, p)))
            except Exception as e:  # a bad tail costs this session its digest line, not the others
                failed += 1
                logger.error("{}: digest line: {}", a["name"], e)
        try:
            for key, event, s, note in events:
                out = add(a, key, event, s, note)
                click.echo(f"{a['name']}: {event} {s} -> {out}")
                if event == "result" and s == "done":
                    finished.append(a["name"])
        except Exception as e:  # one session's failure must not hide the others'
            failed += 1
            logger.error("{}: {}", a["name"], e)
    # Only new information goes out: a line equal to the one last sent for that session is dropped.
    fresh = [(name, line, unchanged(line)) for name, line in lines
             if unchanged(line) != state.get(name, {}).get("digested")]
    if digest_due and lines and not fresh:
        # Checked and nothing to say: the next look is a full interval away, like after a sent digest.
        logger.info("progress digest due, nothing changed since the last one; not sent")
        state[DIGEST] = {"at": now}
    elif digest_due and fresh:
        digest = (f"agent progress {datetime.fromtimestamp(now).strftime('%H:%M')} \u00b7 {len(fresh)} changed\n"
                  + "\n".join(line for _, line, _ in fresh))
        try:
            logger.info("progress digest: {}", post_digest(digest))
            state[DIGEST] = {"at": now}
            for name, _, key in fresh:
                state[name]["digested"] = key
        except Exception as e:  # any failure is a missed digest: logged, not retried here, state still written
            failed += 1
            logger.error("progress digest not sent: {}", e)
    elif digest_due:
        logger.debug("progress digest due, nothing running")
    STATE.parent.mkdir(parents=True, exist_ok=True)
    tmp = STATE.with_suffix(".tmp")
    keep = {a["name"] for a in agents} | {DIGEST}
    tmp.write_text(json.dumps({k: v for k, v in state.items() if k in keep and k not in finished}, indent=1))
    tmp.replace(STATE)
    if finished:
        subprocess.run([*INBOX, "agent", "rm", *finished], check=True, capture_output=True)
        click.echo(f"done, no longer watched: {' '.join(finished)}")
    sys.exit(1 if failed else 0)


if __name__ == "__main__":
    main()
