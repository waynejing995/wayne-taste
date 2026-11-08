#!/usr/bin/env python3
# /// script
# requires-python = ">=3.11"
# dependencies = ["pyyaml", "click", "loguru"]
# ///
"""Turn what the watched Teams chats said since the last run into ledger rows.

A headless omp reads the chats in rules.yaml `teams_watch` (plus the self-chat) and writes JSON lines;
each line becomes `inbox.py ask` (someone waits for Wayne; also an unread gap) or `inbox.py fact`
(a decision or rule). Rows stay open until `done`, so nothing depends on the next run. The cursor moves
only after every line is recorded. Run by the wayne-inbox-teams systemd timer; safe to run by hand.
"""

from __future__ import annotations

import json
import os
import subprocess
import sys
import tempfile
from datetime import datetime, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo

import click
import yaml
from loguru import logger

HERE = Path(__file__).resolve().parent
HOME = Path(os.environ.get("WAYNE_INBOX_DIR", Path.home() / ".wayne" / "inbox"))
CURSOR = HOME / "cursors" / "teams-digest.since"
TZ = ZoneInfo("Asia/Shanghai")
KINDS = {"ask": "ask", "gap": "ask", "fact": "fact"}


def inbox(*args: str) -> str:
    out = subprocess.run(["uv", "run", "--quiet", str(HERE / "inbox.py"), *args], check=True, capture_output=True, text=True)
    return out.stdout.strip()


@click.command()
@click.option("--since", help="YYYY-MM-DD HH:MM Asia/Shanghai; default: the cursor, or 24 h ago on the first run")
@click.option("-v", "--verbose", is_flag=True)
def main(since: str | None, verbose: bool) -> None:
    logger.remove()
    logger.add(sys.stderr, level="DEBUG" if verbose else "INFO")
    now = datetime.now(TZ).strftime("%Y-%m-%d %H:%M")
    if since is None:
        since = CURSOR.read_text().strip() if CURSOR.exists() else (datetime.now(TZ) - timedelta(hours=24)).strftime("%Y-%m-%d %H:%M")
    rules = yaml.safe_load((HOME / "rules.yaml").read_text()) or {}
    chats = (rules.get("teams_watch") or {}).get("chats") or []
    lines = "\n".join(f"- {c['chat']}: `{c['chat_id']}`" for c in chats if c.get("chat_id") != "48:notes")
    with tempfile.TemporaryDirectory() as tmp:
        out = Path(tmp) / "findings.jsonl"
        prompt = (HERE / "teams-digest.prompt.md").read_text()
        prompt = prompt.replace("{{CHATS}}", lines or "(none)").replace("{{SINCE}}", since).replace("{{OUT}}", str(out))
        logger.info("reading {} chats + self-chat since {}", len(chats), since)
        subprocess.run(
            ["omp", "-p", "--no-session", "--no-title", "--max-time", "15m", "--tools", "read,write,teams_read,teams_chats", prompt],
            check=True,
            cwd=tmp,
            stdout=subprocess.DEVNULL,
        )
        if not out.exists():
            raise click.ClickException(f"omp wrote no {out.name}; cursor stays at {since}")
        findings = [json.loads(line) for line in out.read_text().splitlines() if line.strip()]
    for f in findings:
        kind = KINDS.get(f.get("kind"))
        if kind is None or not f.get("key") or not f.get("text"):
            raise click.ClickException(f"bad finding, cursor stays at {since}: {f}")
        # Options first, then `--`: the text is model-written and may start with `-`, which click would read as an option.
        result = inbox(kind, "--key", f["key"], "--source", "teams-digest", "--note", f.get("note", ""), "--", f["text"])
        logger.info("{} {}: {}", f["kind"], f["key"], result)
    CURSOR.parent.mkdir(parents=True, exist_ok=True)
    CURSOR.write_text(now + "\n")
    click.echo(f"teams digest: {len(findings)} findings since {since}")


if __name__ == "__main__":
    main()
