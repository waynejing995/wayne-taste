#!/usr/bin/env python3
"""PreToolUse hook: audit Skill tool usage to a JSONL log.

Append one line per Skill invocation so you can see which local skills you
actually use and prune the rest. Never blocks — exits 0 unconditionally.

Log: ~/.claude/skill-usage.jsonl
Each line: {"ts","skill","args","cwd","session"}
"""
import json
import os
import sys
from datetime import datetime

LOG = os.path.expanduser("~/.claude/skill-usage.jsonl")


def main():
    raw = sys.stdin.read()
    try:
        data = json.loads(raw) if raw.strip() else {}
    except json.JSONDecodeError:
        return  # malformed input: stay silent, never block

    if data.get("tool_name") != "Skill":
        return

    ti = data.get("tool_input", {}) or {}
    entry = {
        "ts": datetime.now().astimezone().isoformat(),
        "skill": ti.get("skill", "<unknown>"),
        "args": ti.get("args", ""),
        "cwd": data.get("cwd", os.getcwd()),
        "session": data.get("session_id", ""),
    }
    try:
        with open(LOG, "a") as f:
            f.write(json.dumps(entry, ensure_ascii=False) + "\n")
    except OSError:
        pass  # logging failure must never break the tool call


if __name__ == "__main__":
    main()
    sys.exit(0)
