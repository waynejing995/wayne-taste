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


def count_direct_skills(skills_dir):
    """Count only direct children: skills_dir/<name>/SKILL.md.

    Plugins keep skills in a flat skills/ dir; counting recursively would also
    pick up nested vendor copies (.factory/, openclaw/, etc.) some plugins bundle,
    inflating the total. One level deep is the real surfaced count.
    """
    if not os.path.isdir(skills_dir):
        return 0
    n = 0
    for name in os.listdir(skills_dir):
        if os.path.isfile(os.path.join(skills_dir, name, "SKILL.md")):
            n += 1
    return n


def latest_version_dir(plugin_dir):
    """Pick one version subdir per plugin (newest by mtime).

    The cache keeps every installed version side by side; summing them all
    double-counts a plugin's skills. Only the latest is actually loaded.
    """
    subdirs = [
        os.path.join(plugin_dir, d)
        for d in os.listdir(plugin_dir)
        if os.path.isdir(os.path.join(plugin_dir, d))
    ]
    if not subdirs:
        return None
    return max(subdirs, key=os.path.getmtime)


def plugin_skill_count(plugin_dir):
    """Skills shipped by a plugin's latest cached version.

    Plugins don't share one layout — some keep skills in skills/, others nest
    under claude-plugin/<name>/skills/. So count SKILL.md anywhere under the
    latest version, but exclude two kinds of non-loaded copies:
      - hidden segments (.claude/, .factory/, etc.) — dev/vendor scaffolding
      - openclaw/ — bundled cross-agent mirrors
    """
    ver = latest_version_dir(plugin_dir)
    if not ver:
        return 0
    n = 0
    for dirpath, _, files in os.walk(ver):
        if "SKILL.md" not in files:
            continue
        rel = os.path.relpath(dirpath, ver)
        segs = rel.split(os.sep)
        if any(s.startswith(".") for s in segs) or "openclaw" in segs:
            continue
        n += 1
    return n


def enabled_plugin_keys():
    """Set of '<plugin>@<marketplace>' keys that are enabled in settings.json."""
    settings = load_json(SETTINGS)
    return {k for k, v in settings.get("enabledPlugins", {}).items() if v}


def walk_plugins():
    """Yield (marketplace, plugin, plugin_dir) for every plugin in the cache."""
    if not os.path.isdir(PLUGIN_CACHE):
        return
    for marketplace in sorted(os.listdir(PLUGIN_CACHE)):
        mp = os.path.join(PLUGIN_CACHE, marketplace)
        if not os.path.isdir(mp):
            continue
        for plugin in sorted(os.listdir(mp)):
            pdir = os.path.join(mp, plugin)
            if os.path.isdir(pdir):
                yield marketplace, plugin, pdir


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
    enabled_keys = {k for k, v in settings.get("enabledPlugins", {}).items() if v}
    disabled_keys = {k for k, v in settings.get("enabledPlugins", {}).items() if not v}
    print(f"- Enabled: **{len(enabled_keys)}**  |  Disabled: **{len(disabled_keys)}**\n")
    print("Only enabled plugins load skills into context. Counts use each plugin's "
          "latest cached version (older versions side by side are not loaded).\n")
    print("| Plugin | Skills shipped |")
    print("|---|---|")
    rows = []
    for marketplace, plugin, pdir in walk_plugins():
        key = f"{plugin}@{marketplace}"
        if key not in enabled_keys:
            continue
        n = plugin_skill_count(pdir)
        rows.append((f"{plugin}@{marketplace}", n))
    for name, n in sorted(rows, key=lambda r: -r[1]):
        print(f"| {name} | {n} |")
    print(f"\n_Enabled plugin skills total: **{sum(n for _, n in rows)}**_")
    if disabled_keys:
        print(f"\n_Disabled plugins (not loaded):_ {', '.join(sorted(disabled_keys))}")
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
    g = count_direct_skills(os.path.join(GLOBAL_CLAUDE, "skills"))
    d = count_direct_skills(os.path.join(GLOBAL_CLAUDE, "skills-disabled"))
    p = count_direct_skills(os.path.join(project_dir, ".claude", "skills"))
    # Plugin skills: only ENABLED plugins, latest version each.
    enabled_keys = enabled_plugin_keys()
    plug = sum(
        plugin_skill_count(pdir)
        for marketplace, plugin, pdir in walk_plugins()
        if f"{plugin}@{marketplace}" in enabled_keys
    )
    print("| Source | Count |")
    print("|---|---|")
    print(f"| global ~/.claude/skills | {g} |")
    print(f"| enabled plugins | {plug} |")
    print(f"| project .claude/skills | {p} |")
    print(f"| **surfaced total (loaded)** | **{g + plug + p}** |")
    print(f"| global disabled (backup, not loaded) | {d} |\n")
    print("> Skill descriptions are the single biggest static cost. Each surfaced skill "
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
