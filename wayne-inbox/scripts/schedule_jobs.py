"""Scheduled jobs stored as the `schedule` list in rules.yaml.

One list, rewritten the way `agent_watch` is: the rest of the file stays byte for byte.
A fire claims `cursors/schedule-<name>-<fire>.claim` so the timer and the session cannot both run it.
The timer runs shell and prompt jobs. A tool job, and any job with `judge: on`, runs only inside the
live omp session, because only that session can call an extension tool or the tiny model.
"""

from __future__ import annotations

import contextlib
import io
import json
import os
import re
import subprocess
import time
from datetime import datetime, timedelta
from pathlib import Path

import click
import yaml

# Loaded lazily: inbox.py imports this module, so a top-level import here would loop.
def ledger():
    import inbox
    return inbox

NAMES = re.compile(r"^[a-z][a-z0-9-]{0,40}$")
KINDS = {"shell", "prompt", "tool"}
HEADER = (
    "# Scheduled jobs. Written by `inbox.py schedule add|rm`; "
    "run by `inbox.py schedule run` and the m365 inbox extension.\n"
)
BLOCK = re.compile(r"(?:^# Scheduled jobs.*\n)?^schedule:.*(?:\n|$)(?:(?:[ \t#].*|)(?:\n|$))*", re.M)
CLAIM_STALE_S = 15 * 60
OUTPUT_CAP = 4000


def home() -> Path:
    return ledger().HOME


def cursors() -> Path:
    path = home() / "cursors"
    path.mkdir(parents=True, exist_ok=True)
    return path


def now() -> datetime:
    return datetime.now(ledger().TZ)


def stamp(value: datetime) -> str:
    return value.strftime("%Y-%m-%d %H:%M")


def parse_stamp(value: str) -> datetime:
    return datetime.strptime(value, "%Y-%m-%d %H:%M").replace(tzinfo=ledger().TZ)


def read_jobs() -> list[dict]:
    data = (yaml.safe_load(ledger().RULES.read_text()) if ledger().RULES.exists() else None) or {}
    jobs = data.get("schedule") or []
    if not isinstance(jobs, list):
        raise click.ClickException(f"{ledger().RULES}: `schedule` must be a list")
    return jobs


def write_jobs(jobs: list[dict]) -> None:
    """Rewrite only the schedule block, kept last; every other byte stays."""
    text = ledger().RULES.read_text() if ledger().RULES.exists() else ""
    rest = BLOCK.sub("", text).rstrip("\n")
    items = yaml.safe_dump(jobs, allow_unicode=True, sort_keys=False) if jobs else "[]\n"
    body = "".join(f"  {line}\n" for line in items.splitlines()) if jobs else " []\n"
    block = HEADER + ("schedule:\n" + body if jobs else "schedule: []\n")
    tmp = ledger().RULES.with_suffix(f".{os.getpid()}.tmp")
    tmp.write_text(f"{rest}\n\n{block}" if rest else block)
    os.replace(tmp, ledger().RULES)


def check_name(name: str) -> str:
    if not NAMES.match(name):
        raise click.ClickException(f"job name must match {NAMES.pattern}, got {name!r}")
    return name


def parse_action(kind: str, text: str) -> dict:
    if kind not in KINDS:
        raise click.ClickException(f"--kind must be one of {sorted(KINDS)}")
    if not text.strip():
        raise click.ClickException("--action must not be empty")
    if kind == "shell":
        try:
            argv = json.loads(text)
        except json.JSONDecodeError as exc:
            raise click.ClickException(f"--action for shell must be a JSON argv list: {exc}") from exc
        if not isinstance(argv, list) or not argv or any(not isinstance(a, str) for a in argv):
            raise click.ClickException("--action for shell must be a non-empty JSON list of strings")
        return {"kind": "shell", "argv": argv}
    if kind == "prompt":
        return {"kind": "prompt", "text": text}
    try:
        spec = json.loads(text)
    except json.JSONDecodeError as exc:
        raise click.ClickException(f"--action for tool must be JSON object with name and args: {exc}") from exc
    if not isinstance(spec, dict) or not isinstance(spec.get("name"), str) or not spec["name"]:
        raise click.ClickException('--action for tool must be {"name": "<tool>", "args": {...}}')
    args = spec.get("args", {})
    if not isinstance(args, dict):
        raise click.ClickException("tool args must be a JSON object")
    return {"kind": "tool", "name": spec["name"], "args": args}


def action_line(action: dict) -> str:
    kind = action.get("kind")
    if kind == "shell":
        return "shell " + " ".join(action.get("argv") or [])
    if kind == "prompt":
        return "prompt " + str(action.get("text") or "")
    if kind == "tool":
        return f"tool {action.get('name')} {json.dumps(action.get('args') or {}, ensure_ascii=False)}"
    return str(kind)


def field(job: dict, *keys: str, default: str = "") -> str:
    value = job
    for key in keys:
        if not isinstance(value, dict) or key not in value:
            return default
        value = value[key]
    return "" if value is None else str(value)


def needs_session(job: dict) -> bool:
    """A tool call and the tiny-model judge exist only inside a live omp session."""
    return job.get("action", {}).get("kind") == "tool" or job.get("judge") == "on"


def cron_field(expr: str, value: int, lo: int, hi: int) -> bool:
    if expr == "*":
        return True
    for part in expr.split(","):
        step = 1
        span = part
        if "/" in part:
            span, raw = part.split("/", 1)
            if not raw.isdigit() or int(raw) < 1:
                raise click.ClickException(f"bad cron step in {expr!r}")
            step = int(raw)
        if span == "*":
            start, end = lo, hi
        elif "-" in span:
            a, b = span.split("-", 1)
            if not a.isdigit() or not b.isdigit():
                raise click.ClickException(f"bad cron range in {expr!r}")
            start, end = int(a), int(b)
        else:
            if not span.isdigit():
                raise click.ClickException(f"bad cron field {expr!r}")
            start = end = int(span)
        if not lo <= start <= end <= hi:
            raise click.ClickException(f"cron field {expr!r} is outside {lo}-{hi}")
        if start <= value <= end and (value - start) % step == 0:
            return True
    return False


def cron_matches(expr: str, when: datetime) -> bool:
    """crontab(5), as cronie implements it: a field is a star when its first character is `*`, so `*/1` is a star.
    Day-of-month and day-of-week are OR only when neither is a star; otherwise they are AND."""
    fields = expr.split()
    if len(fields) != 5:
        raise click.ClickException(f"cron needs 5 fields, got {expr!r}")
    minute, hour, day, month, weekday = fields
    values = (when.minute, when.hour, when.day, when.month, when.isoweekday() % 7)
    bounds = ((0, 59), (0, 23), (1, 31), (1, 12), (0, 6))
    matched = [cron_field(f, v, lo, hi) for f, v, (lo, hi) in zip(fields, values, bounds)]
    if not day.startswith("*") and not weekday.startswith("*"):
        matched[2] = matched[2] or matched[4]
        matched[4] = True
    return all(matched)


def validate_when(cron: str | None, every: int | None) -> None:
    if (cron is None) == (every is None):
        raise click.ClickException("give exactly one of --cron and --every")
    if cron is not None:
        cron_matches(cron, now())  # rejects a bad expression
    elif every < 1:
        raise click.ClickException("--every must be at least 1 minute")


def next_fire(job: dict, after: datetime) -> datetime:
    """The next minute this job is due, strictly after `after` (which is truncated to the minute)."""
    after = after.replace(second=0, microsecond=0)
    every = job.get("every")
    if every:
        return after + timedelta(minutes=int(every))
    cron = str(job.get("cron") or "")
    cursor = after
    for _ in range(366 * 24 * 60):
        cursor += timedelta(minutes=1)
        if cron_matches(cron, cursor):
            return cursor
    raise click.ClickException(f"cron {cron!r} never matches")


def due_jobs(jobs: list[dict], at: datetime) -> list[dict]:
    at = at.replace(second=0, microsecond=0)
    return [
        job for job in jobs
        if job.get("enabled", True) and job.get("next_fire") and parse_stamp(str(job["next_fire"])) <= at
    ]


def fire_id(job: dict) -> str:
    return str(job.get("next_fire") or "").replace(" ", "T").replace(":", "")


def claim_path(name: str, fire: str) -> Path:
    return cursors() / f"schedule-{name}-{fire}.claim"


def claim(name: str, fire: str) -> bool:
    """True when this process owns the fire. A claim older than 15 min is stolen: its runner died."""
    path = claim_path(name, fire)
    try:
        fd = os.open(path, os.O_CREAT | os.O_EXCL | os.O_WRONLY)
    except FileExistsError:
        try:
            age = time.time() - path.stat().st_mtime
        except FileNotFoundError:
            return claim(name, fire)
        if age <= CLAIM_STALE_S:
            return False
        path.unlink(missing_ok=True)
        return claim(name, fire)
    os.write(fd, f"{os.getpid()}\n".encode())
    os.close(fd)
    return True


def release(name: str, fire: str) -> None:
    claim_path(name, fire).unlink(missing_ok=True)


def run_shell(argv: list[str]) -> tuple[str, str]:
    try:
        done = subprocess.run(argv, capture_output=True, text=True, timeout=60, check=False)
    except OSError as exc:
        raise click.ClickException(f"shell failed to start: {exc}") from exc
    except subprocess.TimeoutExpired as exc:
        raise click.ClickException("shell timed out after 60s") from exc
    if done.returncode != 0:
        detail = (done.stderr or done.stdout or "").strip()
        raise click.ClickException(f"shell exited {done.returncode}: {detail[:500]}")
    return (done.stdout or "").strip(), ""


def run_action(job: dict, tool=None) -> tuple[str, str]:
    """Run the action. Returns (output, error). `tool(name, args) -> text` runs an extension tool."""
    action = job.get("action") or {}
    kind = action.get("kind")
    if kind == "shell":
        return run_shell(list(action.get("argv") or []))
    if kind == "prompt":
        return str(action.get("text") or ""), ""
    if kind == "tool":
        if tool is None:
            raise click.ClickException("tool jobs run only inside a live omp session")
        return tool(str(action.get("name") or ""), dict(action.get("args") or {})), ""
    raise click.ClickException(f"unknown action kind {kind!r}")


def record(job: dict, fire: str, output: str, *, action: str, error: str = "") -> str:
    """One ledger row for this fire. `record_direct` dedups, so the same fire writes one row."""
    name = str(job["name"])
    subject = (f"{name} {fire}" if not error else f"{name} {fire} FAILED")[:200]
    note = (error or output)[:OUTPUT_CAP]
    # record_direct prefixes the key with the tag, so the stored key is schedule:<name>:<fire>.
    with contextlib.redirect_stdout(io.StringIO()):
        ledger().record_direct("schedule", action, f"{name}:{fire}", subject, "schedule", note, "", field(job, "owner") or "wayne")
    return f"{action} {name}:{fire}"


def finish(job: dict, at: datetime, status: str, detail: str) -> None:
    job["next_fire"] = stamp(next_fire(job, at))
    job["last"] = {"status": status, "at": stamp(at), "detail": detail[:200]}
    job["fires"] = int(job.get("fires") or 0) + 1


def one(job: dict, at: datetime, *, session: bool, tool=None, judge=None) -> str:
    """Run one due job if this caller can. Returns a one-line result. Leaves it due when it cannot."""
    name = str(job["name"])
    fire = fire_id(job)
    if needs_session(job) and not session:
        return f"skip {name}: needs a live omp session"
    if not claim(name, fire):
        return f"skip {name}: another runner holds {fire}"
    try:
        output, _ = run_action(job, tool)
        ledger_action, status, detail = "notify", "ok", output[:200]
        if job.get("judge") == "on":
            if judge is None:
                raise click.ClickException("judge needs the live session")
            verdict, summary = judge(str(job.get("judge_prompt") or ""), output)
            if verdict == "SKIP":
                ledger_action, status, detail = "log", "skip", summary or "judge skipped"
            elif summary:
                output, detail = f"{summary}\n{output}", summary[:200]
        line = record(job, fire, output, action=ledger_action)
        finish(job, at, status, detail)
        return f"{status} {name} {fire}: {line}"
    except click.ClickException as exc:
        line = record(job, fire, "", action="notify", error=str(exc))
        finish(job, at, "fail", str(exc))
        return f"fail {name} {fire}: {line} ({exc})"
    finally:
        release(name, fire)


def run_due(at: datetime | None = None, *, session: bool = False, tool=None, judge=None) -> list[str]:
    """Claim and run every due job this caller can run. Rewrites the schedule list once."""
    at = (at or now()).replace(second=0, microsecond=0)
    lines: list[str] = []
    with ledger().RulesLock():
        jobs = read_jobs()
        before = [dict(job) for job in jobs]
        for job in due_jobs(jobs, at):
            lines.append(one(job, at, session=session, tool=tool, judge=judge))
        if jobs != before:
            write_jobs(jobs)
    return lines


def widget_lines(jobs: list[dict] | None = None) -> list[str]:
    rows = []
    for job in jobs if jobs is not None else read_jobs():
        last = job.get("last") or {}
        state = last.get("status") or "never"
        rows.append(f"{job.get('name')} next {job.get('next_fire') or '-'} last {state}")
    return rows
