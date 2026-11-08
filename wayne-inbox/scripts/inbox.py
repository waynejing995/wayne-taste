#!/usr/bin/env python3
# /// script
# requires-python = ">=3.11"
# dependencies = ["pyyaml", "click", "loguru"]
# ///
"""Wayne's inbox: classify an incoming event by rules.yaml and keep it in ledger.tsv.

rules.yaml is source -> place (one chat, one repo, one mail folder, one JQL name) -> ordered rules.
Each rule has `when` (exact field values), `action`, and optional `tag` / `owner`; the first match wins.

Only events whose action is do / notify / log are written. An event whose place has no rules, that no
rule matches, or whose rule says ignore is not written. The ledger holds only live rows (open / claimed):
`set` edits one in place, `done` moves it to archive.tsv, which keeps its key so it is not recorded again.
"""

from __future__ import annotations

import csv
import fcntl
import os
import re
import sys
import time
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

import click
import yaml
from loguru import logger

HOME = Path(os.environ.get("WAYNE_INBOX_DIR", Path.home() / ".wayne" / "inbox"))
RULES = HOME / "rules.yaml"
LEDGER = HOME / "ledger.tsv"
ARCHIVE = HOME / "archive.tsv"
LOCK = HOME / ".ledger.lock"
# Same lock file the m365 extension takes to rewrite teams_watch: one writer of rules.yaml at a time.
RULES_LOCK = HOME / "rules.yaml.lock"
# Sections of rules.yaml that are lists kept by programs, not classification rules.
LISTS = {"teams_watch", "agent_watch"}
AGENT_HEADER = "# Agent sessions to watch (tern / herdr / hc / tmux). Written by `inbox.py agent add|rm`; read by watch-agents.py.\n"
AGENT_BLOCK = re.compile(r"(?:^# Agent sessions to watch.*\n)?^agent_watch:.*(?:\n|$)(?:(?:[ \t#].*|)(?:\n|$))*", re.M)
COLUMNS = ["id", "key", "subject", "first_seen", "source", "tag", "action", "state", "owner", "note", "link"]
ACTIONS = {"do", "notify", "log", "ignore"}
STATES = {"open", "claimed"}
TZ = ZoneInfo("Asia/Shanghai")


def load_rules() -> dict[str, dict[str, list[dict]]]:
    """Read and check rules.yaml: source -> place -> ordered rules. A bad file stops the run, because
    classifying with half a rule set silently drops events."""
    if not RULES.exists():
        raise click.ClickException(f"no rules file at {RULES}")
    data = yaml.safe_load(RULES.read_text()) or {}
    if not isinstance(data, dict) or not data:
        raise click.ClickException(f"{RULES}: top level must map source -> place -> rules")
    data = {k: v for k, v in data.items() if k not in LISTS}
    for source, places in data.items():
        if not isinstance(places, dict):
            raise click.ClickException(f"{RULES}: {source}: must map place -> rules")
        for place, rules in places.items():
            where = f"{RULES}: {source} / {place}"
            if not isinstance(rules, list) or not rules:
                raise click.ClickException(f"{where}: must be a non-empty list of rules")
            for i, rule in enumerate(rules, 1):
                if not isinstance(rule, dict) or rule.get("action") not in ACTIONS:
                    raise click.ClickException(f"{where}: rule {i}: `action` must be one of {sorted(ACTIONS)}")
                when = rule.get("when") or {}
                if not isinstance(when, dict):
                    raise click.ClickException(f"{where}: rule {i}: `when` must map field -> value")
                for field, want in when.items():
                    # Events carry strings and matches() compares str() forms, so a value must be a plain scalar.
                    # YAML reads bare yes/no as booleans and an empty value as null, and a nested list or map
                    # stringifies to brackets: none of these ever equals an event value, so the rule would never match.
                    if any(isinstance(w, bool) or not isinstance(w, (str, int, float)) for w in (want if isinstance(want, list) else [want])):
                        raise click.ClickException(f"{where}: rule {i}: `{field}` must be a string or number, or a list of them (quote yes/no, fill empty values)")
    return data


def matches(expected: object, value: str | None) -> bool:
    """Exact match. A list means any of them; a value starting with `!` means anything but it."""
    if value is None:
        return False
    for want in expected if isinstance(expected, list) else [expected]:
        want = str(want)
        if (want.startswith("!") and value != want[1:]) or value == want:
            return True
    return False


def first_match(rules: dict, source: str, place: str, fields: dict[str, str]) -> dict | None:
    """The first rule under source/place whose every `when` field matches; None when the place has no rules.
    A place with no rules of its own falls back to the source's `"*"` rules (for places named at run time,
    such as agent sessions)."""
    places = rules.get(source, {})
    for rule in places.get(place, places.get("*", [])):
        if all(matches(want, fields.get(field)) for field, want in (rule.get("when") or {}).items()):
            return rule
    return None


def read_tsv(path: Path) -> list[dict]:
    if not path.exists():
        return []
    with open(path, newline="") as f:
        reader = csv.DictReader(f, delimiter="\t")
        if reader.fieldnames != COLUMNS:
            raise click.ClickException(f"{path}: header is {reader.fieldnames}, expected {COLUMNS}")
        return list(reader)


def write_tsv(path: Path, rows: list[dict]) -> None:
    tmp = path.with_suffix(".tsv.tmp")
    with open(tmp, "w", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=COLUMNS, delimiter="\t", lineterminator="\n")
        writer.writeheader()
        writer.writerows(rows)
    os.replace(tmp, path)


class Ledger:
    """ledger.tsv (live rows) and archive.tsv (finished rows) under one exclusive lock.
    Writes go to a temp file renamed over the target."""

    def __enter__(self) -> "Ledger":
        HOME.mkdir(parents=True, exist_ok=True)
        self._lock = open(LOCK, "w")
        fcntl.flock(self._lock, fcntl.LOCK_EX)
        self.rows = read_tsv(LEDGER)
        return self

    def save(self) -> None:
        write_tsv(LEDGER, self.rows)

    def __exit__(self, *exc) -> None:
        fcntl.flock(self._lock, fcntl.LOCK_UN)
        self._lock.close()


def clean(text: str) -> str:
    """A TSV cell: no tabs or newlines."""
    return re.sub(r"[\t\r\n]+", " ", text or "").strip()


@click.group()
@click.option("-v", "--verbose", is_flag=True)
def cli(verbose: bool) -> None:
    logger.remove()
    logger.add(sys.stderr, level="DEBUG" if verbose else "INFO")


@cli.command()
@click.option("--source", required=True, help="teams | github | outlook | jira | …")
@click.option("--place", required=True, help="the chat / repo / folder / JQL name under that source in rules.yaml")
@click.option("--key", required=True, help="source + place + native event id, e.g. github:Org/Repo#761:review:123")
@click.option("--subject", required=True, help="what the event is about, e.g. TRACE#761")
@click.option("--field", "fields", multiple=True, help="k=v fields the rules match on (repeatable)")
@click.option("--note", default="")
@click.option("--link", default="")
def add(source: str, place: str, key: str, subject: str, fields: tuple[str, ...], note: str, link: str) -> None:
    """Classify one event. Prints `<action> <id> <tag>` when recorded, `skip <reason>` when not."""
    parsed: dict[str, str] = {}
    for item in fields:
        if "=" not in item:
            raise click.ClickException(f"--field needs k=v, got {item!r}")
        k, v = item.split("=", 1)
        parsed[k] = v
    rule = first_match(load_rules(), source, place, parsed)
    if rule is None:
        click.echo("skip unmatched")
        return
    if rule["action"] == "ignore":
        click.echo("skip ignore")
        return
    with Ledger() as ledger:
        # A finished row stays remembered in the archive, or the next scan would record it again.
        archived = read_tsv(ARCHIVE)
        for row in ledger.rows + archived:
            if row["key"] == key:
                click.echo(f"seen {row['id']} {row['tag']}")
                return
        new_id = max((int(r["id"]) for r in ledger.rows + archived), default=0) + 1
        ledger.rows.append(
            {
                "id": str(new_id),
                "key": clean(key),
                "subject": clean(subject),
                "first_seen": datetime.now(TZ).strftime("%Y-%m-%d %H:%M"),
                "source": source,
                "tag": clean(rule.get("tag", "")),
                "action": rule["action"],
                "state": "open",
                "owner": clean(rule.get("owner", "")),
                "note": clean(note),
                "link": clean(link),
            }
        )
        ledger.save()
    logger.debug("recorded {} as #{} under {}/{}", key, new_id, source, place)
    click.echo(f"{rule['action']} {new_id} {rule.get('tag', '')}")


@cli.command("set")
@click.argument("ids", nargs=-1, required=True)
@click.option("--state", type=click.Choice(sorted(STATES)))
@click.option("--owner", help="who is handling it, e.g. me, tern:review-width@build-host; empty string clears")
@click.option("--note")
def set_(ids: tuple[str, ...], state: str | None, owner: str | None, note: str | None) -> None:
    """Edit live rows in place (state, owner, note)."""
    if state is None and owner is None and note is None:
        raise click.ClickException("nothing to set: give --state, --owner or --note")
    with Ledger() as ledger:
        by_id = {r["id"]: r for r in ledger.rows}
        missing = [i for i in ids if i not in by_id]
        if missing:
            raise click.ClickException(f"no such id: {', '.join(missing)}")
        for i in ids:
            row = by_id[i]
            if state is not None:
                row["state"] = state
            if owner is not None:
                row["owner"] = clean(owner)
            if note is not None:
                row["note"] = clean(note)
        ledger.save()
    click.echo(f"updated {' '.join(ids)}")


def record_direct(tag: str, action: str, key: str, subject: str, source: str, note: str, link: str) -> None:
    """Write one row without rules: the caller already knows what it is. Same key dedup as `add`."""
    key = f"{tag}:{clean(key)}"
    with Ledger() as ledger:
        archived = read_tsv(ARCHIVE)
        for row in ledger.rows + archived:
            if row["key"] == key:
                click.echo(f"seen {row['id']} {tag}")
                return
        new_id = max((int(r["id"]) for r in ledger.rows + archived), default=0) + 1
        ledger.rows.append(
            {
                "id": str(new_id),
                "key": key,
                "subject": clean(subject),
                "first_seen": datetime.now(TZ).strftime("%Y-%m-%d %H:%M"),
                "source": clean(source),
                "tag": tag,
                "action": action,
                "state": "open",
                "owner": "wayne",
                "note": clean(note),
                "link": clean(link),
            }
        )
        ledger.save()
    click.echo(f"{action} {new_id} {tag}")


KEY_HELP = "stable id, so recording the same thing twice keeps one row, e.g. pr761-e9-e21"


@cli.command()
@click.argument("question")
@click.option("--key", required=True, help=KEY_HELP)
@click.option("--source", default="coordinator", help="who raised it: coordinator, digest, a session name")
@click.option("--note", default="", help="where the context is: a RESULT path, a chat and time")
@click.option("--link", default="")
def ask(question: str, key: str, source: str, note: str, link: str) -> None:
    """A question only Wayne can answer: an `ask-wayne` notify row, open until `done` after he answers."""
    record_direct("ask-wayne", "notify", key, question, source, note, link)


@cli.command()
@click.argument("fact")
@click.option("--key", required=True, help=KEY_HELP)
@click.option("--source", default="digest", help="who saw it: digest, coordinator")
@click.option("--note", default="", help="where it was said: chat, who, time")
@click.option("--link", default="")
def fact(fact: str, key: str, source: str, note: str, link: str) -> None:
    """A decision or rule seen in Teams: a `teams-fact` log row (no card), open until Wayne keeps or drops it."""
    record_direct("teams-fact", "log", key, fact, source, note, link)


@cli.command()
@click.argument("ids", nargs=-1, required=True)
@click.option("--note", help="how it ended, e.g. merged / answered in self-chat")
def done(ids: tuple[str, ...], note: str | None) -> None:
    """Finish rows: move them out of the ledger into archive.tsv, which only remembers their keys."""
    with Ledger() as ledger:
        by_id = {r["id"]: r for r in ledger.rows}
        missing = [i for i in ids if i not in by_id]
        if missing:
            raise click.ClickException(f"no such live id: {', '.join(missing)}")
        finished = [by_id[i] for i in ids]
        for row in finished:
            # The archive is the finished state; its state column says so instead of the last live one.
            row["state"] = "done"
            if note is not None:
                row["note"] = clean(note)
        # Archive first: a crash between the two writes leaves a row in both, never in neither.
        write_tsv(ARCHIVE, read_tsv(ARCHIVE) + finished)
        ledger.rows = [r for r in ledger.rows if r["id"] not in ids]
        ledger.save()
    click.echo(f"done {' '.join(ids)}")


@cli.command("ls")
@click.option("--state", type=click.Choice(sorted(STATES)), multiple=True, help="filter; default both")
@click.option("--owner")
@click.option("--subject")
def ls(state: tuple[str, ...], owner: str | None, subject: str | None) -> None:
    """Print matching rows as TSV (pipe to `column -t -s $'\\t'`)."""
    states = set(state) or {"open", "claimed"}
    with Ledger() as ledger:
        rows = [
            r
            for r in ledger.rows
            if r["state"] in states
            and (owner is None or owner in r["owner"])
            and (subject is None or subject in r["subject"])
        ]
    writer = csv.DictWriter(sys.stdout, fieldnames=COLUMNS, delimiter="\t", lineterminator="\n")
    writer.writeheader()
    writer.writerows(rows)


@cli.command()
@click.argument("source")
def places(source: str) -> None:
    """Print the places rules.yaml lists under SOURCE, one per line (watch-prs.sh reads `github`). None is an error."""
    found = [place for place in load_rules().get(source, {}) if place != "*"]
    if not found:
        raise click.ClickException(f"{RULES}: no places under `{source}`")
    click.echo("\n".join(found))


class RulesLock:
    """rules.yaml.lock, created exclusively; a lock older than 10 s belonged to a process that died."""

    def __enter__(self) -> "RulesLock":
        deadline = time.monotonic() + 2
        while True:
            try:
                os.close(os.open(RULES_LOCK, os.O_CREAT | os.O_EXCL | os.O_WRONLY))
                return self
            except FileExistsError:
                try:
                    age = time.time() - RULES_LOCK.stat().st_mtime
                except FileNotFoundError:  # released between our create and this stat: try the create again
                    continue
                if age > 10:
                    RULES_LOCK.unlink(missing_ok=True)
                elif time.monotonic() > deadline:
                    raise click.ClickException(f"{RULES_LOCK} is held by another writer") from None
                else:
                    time.sleep(0.02)

    def __exit__(self, *exc) -> None:
        RULES_LOCK.unlink(missing_ok=True)


def read_agents() -> list[dict]:
    data = (yaml.safe_load(RULES.read_text()) if RULES.exists() else None) or {}
    agents = data.get("agent_watch") or []
    if not isinstance(agents, list):
        raise click.ClickException(f"{RULES}: `agent_watch` must be a list")
    return agents


def write_agents(agents: list[dict]) -> None:
    """Rewrite only the agent_watch block, kept last; every byte of the rest stays as written."""
    text = RULES.read_text() if RULES.exists() else ""
    rest = AGENT_BLOCK.sub("", text).rstrip("\n")
    # Items indented under the key, so the block is the key line plus indented lines (AGENT_BLOCK's shape).
    items = yaml.safe_dump(agents, allow_unicode=True, sort_keys=False) if agents else "[]\n"
    body = "".join(f"  {line}\n" for line in items.splitlines()) if agents else " []\n"
    block = AGENT_HEADER + ("agent_watch:\n" + body if agents else "agent_watch: []\n")
    tmp = RULES.with_suffix(f".{os.getpid()}.tmp")
    tmp.write_text(f"{rest}\n\n{block}" if rest else block)
    os.replace(tmp, RULES)


@cli.group()
def agent() -> None:
    """The agent sessions watch-agents.py watches (the agent_watch section of rules.yaml)."""


@agent.command("add")
@click.argument("name")
@click.option("--mux", type=click.Choice(["tern", "herdr", "hc", "tmux"]), required=True)
@click.option("--pane", required=True, help="tern block id, herdr agent/pane id, hc terminal address (t11), or tmux pane target")
@click.option("--host", default="local", help="local, or an ssh host the pane lives on")
@click.option("--result", default="", help="the deliverable file the session writes its RESULT block to")
@click.option("--goal", default="", help="one line: what it was asked to do")
def agent_add(name: str, mux: str, pane: str, host: str, result: str, goal: str) -> None:
    """Watch one agent session. A second add of the same name replaces it."""
    entry = {"name": name, "mux": mux, "host": host, "pane": pane}
    if result:
        entry["result"] = result
    if goal:
        entry["goal"] = clean(goal)
    entry["since"] = datetime.now(TZ).strftime("%Y-%m-%d %H:%M")
    with RulesLock():
        write_agents([a for a in read_agents() if a.get("name") != name] + [entry])
    click.echo(f"watching {name}")


@agent.command("rm")
@click.argument("names", nargs=-1, required=True)
def agent_rm(names: tuple[str, ...]) -> None:
    """Stop watching agent sessions by name."""
    with RulesLock():
        agents = read_agents()
        missing = [n for n in names if n not in {a.get("name") for a in agents}]
        if missing:
            raise click.ClickException(f"not watched: {', '.join(missing)}")
        write_agents([a for a in agents if a.get("name") not in names])
    click.echo(f"stopped {' '.join(names)}")


@agent.command("ls")
def agent_ls() -> None:
    """The watched agent sessions, one per line."""
    for a in read_agents():
        click.echo("\t".join(str(a.get(k, "")) for k in ("name", "mux", "host", "pane", "result", "since", "goal")))


if __name__ == "__main__":
    cli()
