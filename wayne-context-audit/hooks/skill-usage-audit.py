#!/usr/bin/env python3
"""PreToolUse hook: audit skill usage to a JSONL log, for BOTH Claude and Codex.

Append one line per skill invocation so you can see which local skills you
actually use and prune the rest. Never blocks — exits 0 unconditionally.

Two agents invoke skills differently:

- **Claude** has a first-class `Skill` tool. Payload: tool_name == "Skill",
  tool_input.skill == "<name>". Direct.

- **Codex** has no per-skill tool for file-based skills — it loads a skill by
  reading its SKILL.md (or running a script inside the skill dir) via the `Bash`
  tool. This mirrors Codex's own `detect_implicit_skill_invocation_for_command`:
  parse the bash command, find either a read of `.../<skill>/SKILL.md` (doc read)
  or a runner invoking `.../<skill>/.../script.ext` (script run), and take the
  skill name from the path. Heuristic by nature — a mere file read counts as use.

Log: ~/.claude/skill-usage.jsonl
Each line: {"ts","skill","args","cwd","session","source"}
  source = "claude" | "codex"
"""
import json
import os
import re
import shlex
import sys
from datetime import datetime

LOG = os.path.expanduser("~/.claude/skill-usage.jsonl")

# Runners + script extensions Codex treats as a skill-script run.
RUNNERS = {"python", "python3", "bash", "zsh", "sh", "node", "deno", "ruby", "perl", "pwsh"}
SCRIPT_EXTS = (".py", ".sh", ".js", ".ts", ".rb", ".pl", ".ps1")


def _skill_from_path(path):
    """Given a path that contains a skill dir, return the skill name.

    A skill dir is the parent of SKILL.md, or an ancestor for a script path.
    We match the path segment that looks like a skill: the dir directly holding
    SKILL.md (doc read), or the first ancestor dir for a script. We can't read
    the filesystem reliably here, so we use the path shape:
      - .../<name>/SKILL.md           -> <name>
      - .../<name>/scripts/foo.py     -> <name>  (segment before scripts/)
      - .../<name>/foo.py             -> <name>
    """
    norm = path.replace("\\", "/")
    parts = [p for p in norm.split("/") if p and p != "."]
    if not parts:
        return None
    # Doc read: segment immediately before SKILL.md
    if parts[-1].upper() == "SKILL.MD":
        return parts[-2] if len(parts) >= 2 else None
    # Script run: walk up to the dir that holds the script; the skill name is
    # the segment before a conventional subdir (scripts/hooks/assets/...) or the
    # script's parent dir otherwise.
    SUBDIRS = {"scripts", "hooks", "assets", "references", "templates", "src"}
    # parts[-1] is the script file; parents are parts[:-1]
    parents = parts[:-1]
    for i in range(len(parents) - 1, -1, -1):
        if parents[i] in SUBDIRS and i >= 1:
            return parents[i - 1]
    # no conventional subdir -> the script's direct parent dir
    return parents[-1] if parents else None


def _codex_skill(command):
    """Detect a skill invocation inside a Codex bash command string.

    Returns the skill name or None. Mirrors Codex's two signals:
    doc-read (a path ending in SKILL.md) and script-run (runner + script under
    a skill dir). We scan tokens for any SKILL.md path first, then script runs.
    """
    if not command:
        return None
    try:
        tokens = shlex.split(command)
    except ValueError:
        tokens = command.split()

    # 1) Doc read: any token that is (or ends with) a SKILL.md path.
    for tok in tokens:
        if tok.upper().endswith("SKILL.MD"):
            name = _skill_from_path(tok)
            if name:
                return name
    # Also catch SKILL.md embedded in a non-token-split command (e.g. redirects).
    m = re.search(r"([\w./\-]+/SKILL\.md)", command, re.IGNORECASE)
    if m:
        name = _skill_from_path(m.group(1))
        if name:
            return name

    # 2) Script run: first token is a known runner, first non-flag arg is a
    #    script with a known extension that sits under a skill dir.
    if tokens:
        runner = os.path.basename(tokens[0]).lower()
        runner = runner[:-4] if runner.endswith(".exe") else runner
        if runner in RUNNERS:
            for tok in tokens[1:]:
                if tok == "--" or tok.startswith("-"):
                    continue
                if tok.lower().endswith(SCRIPT_EXTS):
                    return _skill_from_path(tok)
                break
    return None


def _entry(skill, args, cwd, session, source):
    return {
        "ts": datetime.now().astimezone().isoformat(),
        "skill": skill,
        "args": args,
        "cwd": cwd,
        "session": session,
        "source": source,
    }


def main():
    raw = sys.stdin.read()
    try:
        data = json.loads(raw) if raw.strip() else {}
    except json.JSONDecodeError:
        return  # malformed input: stay silent, never block

    tool = data.get("tool_name")
    ti = data.get("tool_input", {}) or {}
    cwd = data.get("cwd", os.getcwd())
    session = data.get("session_id", "")

    entry = None
    if tool == "Skill":
        # Claude: first-class skill tool.
        entry = _entry(ti.get("skill", "<unknown>"), ti.get("args", ""), cwd, session, "claude")
    elif tool == "Bash":
        # Codex (or any bash): infer skill from SKILL.md read / skill-dir script.
        name = _codex_skill(ti.get("command", ""))
        if name:
            entry = _entry(name, "", cwd, session, "codex")

    if entry is None:
        return  # not a skill invocation we recognize

    try:
        with open(LOG, "a") as f:
            f.write(json.dumps(entry, ensure_ascii=False) + "\n")
    except OSError:
        pass  # logging failure must never break the tool call


if __name__ == "__main__":
    main()
    sys.exit(0)
