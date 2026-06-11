#!/usr/bin/env python3
"""Measure the static context loaded at turn zero (the 'launch footprint').

Reports the fixed cost paid before the user types anything:
  - CLAUDE.md / memory files loaded into context
  - enabled plugins and how many skills each ships
  - configured MCP servers (the deferred-tool surface)
  - total skills surfaced (global + plugin + project)

Read-only. Prints a markdown report to stdout. Counts are line/word/byte —
a proxy for token cost, not exact tokens.
"""
import json
import os
import sys

import click
from loguru import logger

HOME = os.path.expanduser("~")
GLOBAL_CLAUDE = os.path.join(HOME, ".claude")
SETTINGS = os.path.join(GLOBAL_CLAUDE, "settings.json")
CLAUDE_JSON = os.path.join(HOME, ".claude.json")
PLUGIN_CACHE = os.path.join(GLOBAL_CLAUDE, "plugins", "cache")


def file_stats(path):
    if not os.path.isfile(path):
        return None
    with open(path, errors="replace") as f:
        text = f.read()
    return {"lines": text.count("\n") + 1, "words": len(text.split()), "bytes": len(text.encode())}


def count_skills(root):
    """Count SKILL.md files under a directory (one per skill)."""
    if not os.path.isdir(root):
        return 0
    n = 0
    for dirpath, _, files in os.walk(root):
        if "SKILL.md" in files:
            n += 1
    return n


def load_json(path):
    if not os.path.isfile(path):
        return {}
    try:
        with open(path) as f:
            return json.load(f)
    except (json.JSONDecodeError, OSError) as e:
        logger.warning(f"could not parse {path}: {e}")
        return {}


def section_claude_md(project_dir):
    print("## CLAUDE.md / memory (loaded at turn zero)\n")
    print("| File | Lines | Words | Bytes |")
    print("|---|---|---|---|")
    targets = [
        ("global ~/.claude/CLAUDE.md", os.path.join(GLOBAL_CLAUDE, "CLAUDE.md")),
        ("project CLAUDE.md", os.path.join(project_dir, "CLAUDE.md")),
    ]
    # auto-memory MEMORY.md — ONLY the current project's loads at turn zero.
    # Project dir is slug-encoded: /work/Triage_Agent -> -work-Triage-Agent
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


def section_plugins():
    print("## Enabled plugins + skills shipped\n")
    settings = load_json(SETTINGS)
    enabled = {k: v for k, v in settings.get("enabledPlugins", {}).items() if v}
    disabled = {k: v for k, v in settings.get("enabledPlugins", {}).items() if not v}
    print(f"- Enabled: **{len(enabled)}**  |  Disabled: **{len(disabled)}**\n")
    print("| Plugin | Skills shipped |")
    print("|---|---|")
    rows = []
    if os.path.isdir(PLUGIN_CACHE):
        for marketplace in os.listdir(PLUGIN_CACHE):
            mp = os.path.join(PLUGIN_CACHE, marketplace)
            if not os.path.isdir(mp):
                continue
            for plugin in os.listdir(mp):
                pdir = os.path.join(mp, plugin)
                # version subdir(s)
                n = count_skills(pdir)
                if n:
                    rows.append((f"{marketplace}/{plugin}", n))
    for name, n in sorted(rows, key=lambda r: -r[1]):
        print(f"| {name} | {n} |")
    if disabled:
        print(f"\n_Disabled plugins:_ {', '.join(sorted(disabled))}")
    print()


def section_mcp():
    print("## MCP servers (deferred-tool surface)\n")
    # global (~/.claude.json top-level + per-project), plus project .mcp.json
    cj = load_json(CLAUDE_JSON)
    glob = list(cj.get("mcpServers", {}).keys())
    print(f"- Global (~/.claude.json): {', '.join(glob) if glob else '_none_'}")
    print("- Each MCP server contributes its full tool schema set to the deferred-tool list.")
    print("  Heavy servers (atlassian/confluence ~60 tools, log-parser, code-index) dominate.\n")


def section_skill_total(project_dir):
    print("## Total skills surfaced\n")
    g = count_skills(os.path.join(GLOBAL_CLAUDE, "skills"))
    d = count_skills(os.path.join(GLOBAL_CLAUDE, "skills-disabled"))
    p = count_skills(os.path.join(project_dir, ".claude", "skills"))
    plug = 0
    if os.path.isdir(PLUGIN_CACHE):
        plug = count_skills(PLUGIN_CACHE)
    print("| Source | Count |")
    print("|---|---|")
    print(f"| global ~/.claude/skills | {g} |")
    print(f"| plugin-provided (cache) | {plug} |")
    print(f"| project .claude/skills | {p} |")
    print(f"| **surfaced total (enabled)** | **{g + plug + p}** |")
    print(f"| disabled (backup, not loaded) | {d} |\n")
    print("> Skill descriptions are the single biggest static cost. Each enabled skill "
          "adds its name + description to every session's turn-zero context.\n")


@click.command()
@click.option("--project", default=".", help="project dir for project-scoped files")
@click.option("-v", "--verbose", is_flag=True)
def main(project, verbose):
    logger.remove()
    logger.add(sys.stderr, level="DEBUG" if verbose else "INFO")
    project = os.path.abspath(project)

    print("# Launch Context Footprint\n")
    print(f"Project: `{project}`\n")
    section_claude_md(project)
    section_skill_total(project)
    section_plugins()
    section_mcp()
    print("---\n_Counts are line/word/byte proxies, not exact tokens. "
          "Biggest levers: disable unused plugins, trim CLAUDE.md, move unused skills to skills-disabled/._")


if __name__ == "__main__":
    main()
