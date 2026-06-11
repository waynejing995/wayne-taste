#!/usr/bin/env python3
"""Measure the static context loaded at turn zero (the 'launch footprint').

Reports the fixed cost paid before the user types anything:
  - CLAUDE.md / memory files loaded into context (size proxy)
  - enabled plugins + their authoritative projected token cost (via the CLI)
  - local standalone skills under ~/.claude/skills/
  - MCP servers (the deferred-tool surface)

Authority: plugin data comes from `claude plugin list --json` and
`claude plugin details`, NOT from walking the cache. The CLI knows which
version is loaded, which plugin is enabled, and the real token cost — so we
don't re-derive any of that with fragile filesystem heuristics. The only
thing we read off disk is the size of CLAUDE.md/memory and the flat list of
local standalone skills (one level, no version/layout traps).

Read-only. Prints a markdown report to stdout.
"""
import json
import os
import subprocess
import sys

import click
from loguru import logger

HOME = os.path.expanduser("~")
GLOBAL_CLAUDE = os.path.join(HOME, ".claude")
CLAUDE_JSON = os.path.join(HOME, ".claude.json")
SKILLS_DIR = os.path.join(GLOBAL_CLAUDE, "skills")
DISABLED_DIR = os.path.join(GLOBAL_CLAUDE, "skills-disabled")


def file_stats(path):
    if not os.path.isfile(path):
        return None
    with open(path, errors="replace") as f:
        text = f.read()
    return {"lines": text.count("\n") + 1, "words": len(text.split()), "bytes": len(text.encode())}


def list_dir_skills(skills_dir):
    """Flat list of <name> where <name>/SKILL.md exists. One level, no traps."""
    if not os.path.isdir(skills_dir):
        return []
    return sorted(
        n for n in os.listdir(skills_dir)
        if os.path.isfile(os.path.join(skills_dir, n, "SKILL.md"))
    )


def load_json_file(path):
    if not os.path.isfile(path):
        return {}
    try:
        with open(path) as f:
            return json.load(f)
    except (json.JSONDecodeError, OSError) as e:
        logger.warning(f"could not parse {path}: {e}")
        return {}


def run_cli(args):
    """Run a `claude` subcommand, return stdout or None on failure."""
    try:
        r = subprocess.run(
            ["claude", *args], capture_output=True, text=True, timeout=60
        )
    except (FileNotFoundError, subprocess.TimeoutExpired) as e:
        logger.warning(f"`claude {' '.join(args)}` unavailable: {e}")
        return None
    if r.returncode != 0:
        logger.warning(f"`claude {' '.join(args)}` exit {r.returncode}: {r.stderr.strip()[:200]}")
        return None
    return r.stdout


def plugin_list():
    """Authoritative plugin inventory from the CLI. [] if CLI unavailable."""
    out = run_cli(["plugin", "list", "--json"])
    if not out:
        return None
    try:
        return json.loads(out)
    except json.JSONDecodeError:
        logger.warning("could not parse `plugin list --json` output")
        return None


def plugin_detail(plugin_id):
    """Parse `claude plugin details <id>` for skill count + always-on tokens.

    Returns dict {skills: int, always_on: int|None}. The CLI is the source of
    truth for both — no filesystem fallback, because that's exactly the
    guessing we're trying to eliminate.
    """
    out = run_cli(["plugin", "details", plugin_id])
    if not out:
        return {"skills": None, "always_on": None}
    skills = None
    always_on = None
    for line in out.splitlines():
        s = line.strip()
        if s.startswith("Skills (") and skills is None:
            # "Skills (14)  brainstorming, ..."
            try:
                skills = int(s.split("(", 1)[1].split(")", 1)[0])
            except (IndexError, ValueError):
                pass
        elif s.startswith("Always-on:") and always_on is None:
            # "Always-on:   ~484 tok   added to every session"
            digits = "".join(c for c in s if c.isdigit())
            always_on = int(digits) if digits else None
    return {"skills": skills, "always_on": always_on}


def section_claude_md(project_dir):
    print("## CLAUDE.md / memory (loaded at turn zero)\n")
    print("| File | Lines | Words | Bytes |")
    print("|---|---|---|---|")
    targets = [
        ("global ~/.claude/CLAUDE.md", os.path.join(GLOBAL_CLAUDE, "CLAUDE.md")),
        ("project CLAUDE.md", os.path.join(project_dir, "CLAUDE.md")),
    ]
    # auto-memory MEMORY.md — only the current project's loads at turn zero.
    slug = project_dir.replace("/", "-").replace("_", "-")
    mp = os.path.join(GLOBAL_CLAUDE, "projects", slug, "memory", "MEMORY.md")
    targets.append((f"memory ({slug})", mp))
    total = {"lines": 0, "words": 0, "bytes": 0}
    for label, path in targets:
        s = file_stats(path)
        if s:
            print(f"| {label} | {s['lines']} | {s['words']} | {s['bytes']} |")
            for k in total:
                total[k] += s[k]
        else:
            print(f"| {label} | _absent_ | | |")
    print(f"| **TOTAL** | **{total['lines']}** | **{total['words']}** | **{total['bytes']}** |\n")


def section_plugins(plugins):
    print("## Plugins (authoritative — via `claude plugin`)\n")
    if plugins is None:
        print("_`claude plugin list` unavailable — skipping. Install/PATH the `claude` CLI._\n")
        return
    enabled = [p for p in plugins if p.get("enabled")]
    disabled = [p for p in plugins if not p.get("enabled")]
    print(f"- Installed: **{len(plugins)}**  |  Enabled: **{len(enabled)}**  |  Disabled: **{len(disabled)}**\n")
    print("Token cost is the CLI's own projection — real, not a byte proxy. "
          "`always-on` is paid every session; only enabled plugins count.\n")
    print("| Plugin | Skills | Always-on tok |")
    print("|---|---|---|")
    rows = []
    total_always = 0
    for p in sorted(enabled, key=lambda x: x["id"]):
        d = plugin_detail(p["id"])
        sk = d["skills"]
        ao = d["always_on"]
        if ao:
            total_always += ao
        rows.append((p["id"], sk, ao))
    for pid, sk, ao in sorted(rows, key=lambda r: -(r[2] or 0)):
        sk_s = "?" if sk is None else str(sk)
        ao_s = "?" if ao is None else f"~{ao}"
        print(f"| {pid} | {sk_s} | {ao_s} |")
    print(f"\n_Enabled plugins' always-on total: **~{total_always} tok/session**_")
    if disabled:
        print(f"\n_Disabled (not loaded):_ {', '.join(sorted(p['id'] for p in disabled))}")
    print()


def section_local_skills(project_dir):
    print("## Local standalone skills (not plugin-provided)\n")
    g = list_dir_skills(SKILLS_DIR)
    d = list_dir_skills(DISABLED_DIR)
    p = list_dir_skills(os.path.join(project_dir, ".claude", "skills"))
    print("| Source | Count |")
    print("|---|---|")
    print(f"| global ~/.claude/skills | {len(g)} |")
    print(f"| project .claude/skills | {len(p)} |")
    print(f"| disabled (~/.claude/skills-disabled, not loaded) | {len(d)} |\n")
    print("> These surface as skills too. Each adds its name + description to "
          "every session. Move unused ones to skills-disabled/ to reclaim it.\n")


def section_mcp():
    print("## MCP servers (deferred-tool surface)\n")
    cj = load_json_file(CLAUDE_JSON)
    glob = list(cj.get("mcpServers", {}).keys())
    print(f"- Global (~/.claude.json): {', '.join(glob) if glob else '_none_'}")
    print("- Each server contributes its full tool schema set to the deferred-tool list; "
          "heavy ones (atlassian/confluence ~60 tools) dominate.\n")


@click.command()
@click.option("--project", default=".", help="project dir for project-scoped files")
@click.option("-v", "--verbose", is_flag=True)
def main(project, verbose):
    logger.remove()
    logger.add(sys.stderr, level="DEBUG" if verbose else "INFO")
    project = os.path.abspath(project)

    plugins = plugin_list()

    print("# Launch Context Footprint\n")
    print(f"Project: `{project}`\n")
    section_claude_md(project)
    section_plugins(plugins)
    section_local_skills(project)
    section_mcp()
    print("---\n_Plugin token costs are the CLI's projection (authoritative). "
          "CLAUDE.md/memory are size proxies. Biggest levers: disable unused plugins, "
          "trim CLAUDE.md, move unused local skills to skills-disabled/._")


if __name__ == "__main__":
    main()
