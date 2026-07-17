#!/usr/bin/env bash
# codex-dispatch.sh — dispatch a goal-prompt file to Codex's REAL goal subsystem,
# in the background, with a JSONL event log and a mid-run message inbox.
#
# ONE mode: goal. It launches codex_goal_driver.py, which drives `codex app-server`
# over JSON-RPC (initialize → thread/start → thread/goal/set → turn/start) under
# YOLO (sandbox=danger-full-access + approvalPolicy=never) and watches the goal to
# `complete`. Unlike a one-shot `codex exec` turn, a live goal thread accepts
# mid-run messages via `thread/inject_items` — so you can feed a review or a
# course-correction WHILE the worker runs (see `inject`). No rmux, no send-keys.
#
# YOLO params also sidestep bwrap, which fails `RTM_NEWADDR: Operation not
# permitted` on some hosts (the same failure that makes the OpenAI codex-plugin's
# `task` channel unusable there — it hardcodes workspace-write).
#
# Usage:
#   codex-dispatch.sh dispatch <goal-file> [cwd] [--token-budget N]  -> start, print JOB_ID
#   codex-dispatch.sh status   <job-id>                              -> running? goal status? last log
#   codex-dispatch.sh tail     <job-id> [grep-regex]                 -> follow the JSONL log (push)
#   codex-dispatch.sh inject   <job-id> <text | @file>               -> feed a message into the LIVE thread
#   codex-dispatch.sh resume   <job-id>                              -> reactivate the SAME blocked/paused thread
#   codex-dispatch.sh list                                           -> list jobs for this cwd
#
# The JSONL log is the monitor's push source: `tail -F` it and grep your own unit
# marker. Nothing polls a TUI (there isn't one).
set -euo pipefail

JOBROOT="${CODEX_DISPATCH_HOME:-$HOME/.codex-dispatch}"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DRIVER="$HERE/codex_goal_driver.py"

die() { echo "codex-dispatch: $*" >&2; exit 1; }
ws_slug() { echo "$1" | sed 's#[^A-Za-z0-9]#-#g;s#--*#-#g;s#^-##;s#-$##'; }

cmd_dispatch() {
  command -v uv >/dev/null 2>&1 || die "uv not on PATH (driver runs via 'uv run <script>')"
  [ -f "$DRIVER" ] || die "goal driver not found: $DRIVER"
  local goal_file="${1:-}"; shift || true
  local cwd="$PWD" budget=""
  while [ $# -gt 0 ]; do
    case "$1" in
      --token-budget) budget="$2"; shift 2;;
      *) cwd="$1"; shift;;
    esac
  done
  [ -n "$goal_file" ] || die "dispatch needs a goal file"
  [ -f "$goal_file" ] || die "goal file not found: $goal_file"
  cwd="$(cd "$cwd" && pwd)"
  goal_file="$(cd "$(dirname "$goal_file")" && pwd)/$(basename "$goal_file")"

  local slug jobid jobdir
  slug="$(ws_slug "$cwd")"
  jobid="job-$(date +%Y%m%d-%H%M%S)-$$"
  jobdir="$JOBROOT/$slug/$jobid"
  mkdir -p "$jobdir/inbox"

  local log="$jobdir/events.jsonl"
  local drvlog="$jobdir/driver.log"
  local meta="$jobdir/meta.env"
  local control="$jobdir/control"
  mkdir -p "$control"

  local budget_args=()
  [ -n "$budget" ] && budget_args=(--token-budget "$budget")

  nohup uv run "$DRIVER" \
      --goal-file "$goal_file" \
      --cwd "$cwd" \
      --log "$log" \
      --inbox "$jobdir/inbox" \
      --control "$control" \
      "${budget_args[@]}" \
      -v \
      > "$drvlog" 2>&1 &
  local pid=$!

  {
    echo "JOB_ID=$jobid"; echo "CWD=$cwd"; echo "GOAL_FILE=$goal_file"
    echo "LOG=$log"; echo "DRIVER_LOG=$drvlog"; echo "INBOX=$jobdir/inbox"
    echo "CONTROL=$control"
    echo "PID=$pid"; echo "STARTED=$(date -Iseconds)"
  } > "$meta"

  local attempts=$(( ${WAYNE_DISPATCH_STARTUP_TIMEOUT:-15} * 20 )) ready=""
  for _ in $(seq 1 "$attempts"); do
    if [ -s "$control/ready" ]; then ready=1; break; fi
    if ! kill -0 "$pid" 2>/dev/null; then
      echo "codex-dispatch: worker failed before readiness" >&2
      tail -20 "$drvlog" >&2 || true
      return 1
    fi
    sleep 0.05
  done
  if [ -z "$ready" ]; then
    kill "$pid" 2>/dev/null || true
    echo "codex-dispatch: readiness timeout; log preserved at $drvlog" >&2
    return 1
  fi

  echo "$jobid"
  echo "  cwd:    $cwd" >&2
  echo "  log:    $log" >&2
  echo "  inbox:  $jobdir/inbox  (feed mid-run with: $0 inject $jobid '<text>')" >&2
  echo "  pid:    $pid" >&2
  echo "monitor:  tail -F $log | grep -E '>>> UNIT|\"type\":\"error\"'" >&2
}

_jobdir() {
  local jobid="$1"
  local hit; hit="$(find "$JOBROOT" -maxdepth 2 -type d -name "$jobid" 2>/dev/null | head -1)"
  [ -n "$hit" ] || die "unknown job: $jobid"
  echo "$hit"
}

cmd_status() {
  local jobid="${1:-}"; [ -n "$jobid" ] || die "status needs a job-id"
  local jd; jd="$(_jobdir "$jobid")"; source "$jd/meta.env"
  local state="running"; kill -0 "$PID" 2>/dev/null || state="stopped"
  echo "job:     $jobid"
  echo "state:   $state (pid $PID)"
  echo "cwd:     $CWD"
  echo "log:     $LOG"
  echo "inbox:   $INBOX"
  echo "goal:    $(cat "$CONTROL/status" 2>/dev/null || echo starting)"
  echo "--- last goal status ---"
  grep -oE 'goal.status = [a-z]+|GOAL COMPLETE|goal ended [a-z-]+' "$DRIVER_LOG" 2>/dev/null | tail -3 || true
  echo "--- log tail ---"; tail -6 "$LOG" 2>/dev/null || true
}

cmd_tail() {
  local jobid="${1:-}"; [ -n "$jobid" ] || die "tail needs a job-id"
  local re="${2:->>> UNIT|\"type\":\"error\"|\"type\":\"turn.failed\"|GOAL COMPLETE}"
  local jd; jd="$(_jobdir "$jobid")"; source "$jd/meta.env"
  exec tail -n +1 -F "$LOG" | grep -E --line-buffered "$re"
}

cmd_inject() {
  local jobid="${1:-}"; local text="${2:-}"
  [ -n "$jobid" ] || die "inject needs a job-id"
  [ -n "$text" ] || die "inject needs text or a @file path"
  local jd; jd="$(_jobdir "$jobid")"; source "$jd/meta.env"
  local payload="$text"
  [ "${text:0:1}" = "@" ] && payload="$(cat "${text:1}")"
  local msg="$INBOX/msg-$(date +%H%M%S-%N).txt"
  printf '%s\n' "$payload" > "$msg"
  echo "queued mid-run message -> $msg (driver injects into live thread for ${jobid})"
}

cmd_resume() {
  local jobid="${1:-}"; [ -n "$jobid" ] || die "resume needs a job-id"
  local jd; jd="$(_jobdir "$jobid")"; source "$jd/meta.env"
  kill -0 "$PID" 2>/dev/null || die "job is not live: $jobid"
  local current; current="$(cat "$CONTROL/status" 2>/dev/null || true)"
  case "$current" in
    paused|blocked) ;;
    *) die "job is not resumable (status=${current:-unknown})";;
  esac
  printf '%s\n' "$current" > "$CONTROL/resume.request"
  local accepted=""
  for _ in $(seq 1 100); do
    [ ! -e "$CONTROL/resume.request" ] && { accepted=1; break; }
    kill -0 "$PID" 2>/dev/null || break
    sleep 0.05
  done
  [ -n "$accepted" ] || die "resume was not accepted; see $DRIVER_LOG"
  echo "resumed same thread for $jobid"
}

cmd_list() {
  local slug base; slug="$(ws_slug "$PWD")"; base="$JOBROOT/$slug"
  [ -d "$base" ] || { echo "no jobs for $PWD"; return; }
  for jd in "$base"/*/; do
    [ -f "$jd/meta.env" ] || continue
    ( source "$jd/meta.env"
      local st="running"; kill -0 "$PID" 2>/dev/null || st="stopped"
      printf '%-32s %-8s %s\n' "$JOB_ID" "$st" "$STARTED" )
  done
}

case "${1:-}" in
  dispatch) shift; cmd_dispatch "$@";;
  status)   shift; cmd_status "$@";;
  tail)     shift; cmd_tail "$@";;
  inject)   shift; cmd_inject "$@";;
  resume)   shift; cmd_resume "$@";;
  list)     shift; cmd_list "$@";;
  *) die "usage: dispatch <goal-file> [cwd] [--token-budget N] | status <id> | tail <id> [regex] | inject <id> <text|@file> | resume <id> | list";;
esac
