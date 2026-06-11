#!/usr/bin/env python3
"""Analyze skill-usage.jsonl against installed skills to find prune candidates.

Cross-references the PreToolUse audit log (what you actually invoke) with the
set of installed local skills under ~/.claude/skills/, and reports:
  - usage counts per skill (with last-used date + days idle)
  - installed-but-never-used skills (prune candidates)
  - already-disabled skills still showing usage (re-enable candidates)

Read-only. Prints a markdown report to stdout.
"""
import json
import os
import sys
from collections import Counter
from datetime import datetime

import click
from loguru import logger

LOG = os.path.expanduser("~/.claude/skill-usage.jsonl")
SKILLS_DIR = os.path.expanduser("~/.claude/skills")
DISABLED_DIR = os.path.expanduser("~/.claude/skills-disabled")


def load_events(path):
    events = []
    if not os.path.exists(path):
        logger.warning(f"no usage log at {path} — nothing recorded yet")
        return events
    with open(path) as f:
        for ln, line in enumerate(f, 1):
            line = line.strip()
            if not line:
                continue
            try:
                events.append(json.loads(line))
            except json.JSONDecodeError:
                logger.warning(f"skipping malformed line {ln}")
    return events


def installed_skills(d):
    if not os.path.isdir(d):
        return set()
    return {
        n for n in os.listdir(d)
        if os.path.isfile(os.path.join(d, n, "SKILL.md"))
    }


def days_idle(iso):
    try:
        last = datetime.fromisoformat(iso)
        now = datetime.now().astimezone()
        return (now - last).days
    except (ValueError, TypeError):
        return None


@click.command()
@click.option("--log", default=LOG, help="path to skill-usage.jsonl")
@click.option("--idle-days", default=30, help="flag used skills idle longer than this")
@click.option("-v", "--verbose", is_flag=True)
def main(log, idle_days, verbose):
    logger.remove()
    logger.add(sys.stderr, level="DEBUG" if verbose else "INFO")

    events = load_events(log)
    counts = Counter(e.get("skill", "<unknown>") for e in events)
    last_used = {}
    for e in events:
        s, ts = e.get("skill"), e.get("ts")
        if s and ts and (s not in last_used or ts > last_used[s]):
            last_used[s] = ts

    enabled = installed_skills(SKILLS_DIR)
    disabled = installed_skills(DISABLED_DIR)
    used = set(counts)

    print(f"# Skill Usage Audit\n")
    print(f"- Events logged: **{len(events)}**")
    print(f"- Distinct skills used: **{len(used)}**")
    print(f"- Installed (enabled): **{len(enabled)}**  |  Disabled: **{len(disabled)}**\n")

    print("## Used skills (by count)\n")
    print("| Skill | Count | Last used | Days idle | Status |")
    print("|---|---|---|---|---|")
    for s, c in counts.most_common():
        lu = last_used.get(s, "")
        di = days_idle(lu)
        di_s = "—" if di is None else str(di)
        status = "enabled" if s in enabled else ("DISABLED" if s in disabled else "external/plugin")
        flag = " ⚠️idle" if (di is not None and di > idle_days) else ""
        print(f"| {s} | {c} | {lu[:10]} | {di_s}{flag} | {status} |")

    never = sorted(enabled - used)
    print(f"\n## Installed but NEVER used — prune candidates ({len(never)})\n")
    if never:
        for s in never:
            print(f"- {s}")
    else:
        print("_none_")

    reenable = sorted(disabled & used)
    print(f"\n## Disabled but still invoked — re-enable candidates ({len(reenable)})\n")
    if reenable:
        for s in reenable:
            print(f"- {s} (used {counts[s]}×)")
    else:
        print("_none_")


if __name__ == "__main__":
    main()
