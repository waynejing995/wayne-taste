#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.11"
# dependencies = [
#   "click>=8.1",
#   "loguru>=0.7",
#   "pyyaml>=6.0",
# ]
# ///
"""Validate the static Wayne skill contract."""

from __future__ import annotations

import json
import re
import sys
from collections import Counter
from pathlib import Path

import click
import yaml
from loguru import logger


NAME_RE = re.compile(r"^[a-z0-9]+(?:-[a-z0-9]+)*$")
FRONTMATTER_RE = re.compile(r"\A---\s*\n(.*?)\n---\s*\n(.*)\Z", re.DOTALL)
MARKDOWN_LINK_RE = re.compile(r"\[[^\]]+\]\(([^)]+)\)")
DOT_BLOCK_RE = re.compile(r"```dot\s*\n(.*?)\n```", re.DOTALL)
DOT_ID = r'(?:"[^"]+"|[A-Za-z][A-Za-z0-9_]*)'
DOT_NODE_RE = re.compile(rf"^\s*({DOT_ID})\s*\[([^\]]+)]\s*;", re.MULTILINE)
DOT_EDGE_RE = re.compile(
    rf"^\s*({DOT_ID})\s*->\s*({DOT_ID})"
    r"(?:\s*\[([^\]]+)])?\s*;",
    re.MULTILINE,
)


def finding(level: str, code: str, message: str) -> dict[str, str]:
    return {"level": level, "code": code, "message": message}


def parse_skill(path: Path) -> tuple[dict[str, object], str, list[dict[str, str]]]:
    text = path.read_text(encoding="utf-8")
    match = FRONTMATTER_RE.match(text)
    if not match:
        return {}, text, [finding("error", "frontmatter", "missing or malformed YAML frontmatter")]

    try:
        data = yaml.safe_load(match.group(1))
    except yaml.YAMLError as exc:
        return {}, match.group(2), [finding("error", "frontmatter", f"invalid YAML: {exc}")]

    if not isinstance(data, dict):
        return {}, match.group(2), [finding("error", "frontmatter", "frontmatter must be a mapping")]
    return data, match.group(2), []


def validate(skill_dir: Path) -> tuple[list[dict[str, str]], dict[str, int]]:
    skill_path = skill_dir / "SKILL.md"
    if not skill_path.is_file():
        return [finding("error", "skill-file", f"missing {skill_path}")], {}

    text = skill_path.read_text(encoding="utf-8")
    data, body, findings = parse_skill(skill_path)
    keys = set(data)
    if keys != {"name", "description"}:
        findings.append(
            finding(
                "error",
                "frontmatter-keys",
                f"frontmatter keys must be name + description; found {sorted(keys)}",
            )
        )

    name = data.get("name")
    description = data.get("description")
    if not isinstance(name, str) or not NAME_RE.fullmatch(name):
        findings.append(finding("error", "name", "name must be lowercase kebab-case"))
    elif name != skill_dir.name:
        findings.append(
            finding("error", "name-directory", f"name {name!r} does not match directory {skill_dir.name!r}")
        )

    if not isinstance(description, str) or not description.strip():
        findings.append(finding("error", "description", "description must be a non-empty string"))
        description_text = ""
    else:
        description_text = description.strip()
        if len(description_text) > 1024:
            findings.append(finding("error", "description-length", "description exceeds 1,024 characters"))
        elif len(description_text) > 400:
            findings.append(
                finding("warning", "description-target", "description exceeds the 400-character lean target")
            )

    lines = len(text.splitlines())
    words = len(text.split())
    if lines >= 500:
        findings.append(finding("error", "line-limit", f"SKILL.md has {lines} lines; hard limit is <500"))
    elif lines > 180:
        findings.append(finding("warning", "line-target", f"SKILL.md has {lines} lines; lean target is <=180"))
    if words > 1500:
        findings.append(finding("warning", "word-target", f"SKILL.md has {words} words; lean target is <=1,500"))

    if re.search(r"^##\s+Inherits from\b", body, re.MULTILINE | re.IGNORECASE):
        findings.append(finding("error", "inherits", "global invariant blocks belong in AGENTS.md / CLAUDE.md"))
    if re.search(r"^##\s+When to Run\b", body, re.MULTILINE | re.IGNORECASE):
        findings.append(finding("error", "when-to-run", "routing belongs in frontmatter description"))

    h2_headings = re.findall(r"^##\s+(.+?)\s*$", body, re.MULTILINE)
    duplicates = sorted(h for h, count in Counter(h2_headings).items() if count > 1)
    if duplicates:
        findings.append(finding("error", "duplicate-heading", f"duplicate level-two sections: {duplicates}"))

    dot_blocks = DOT_BLOCK_RE.findall(body)
    has_flow = bool(re.search(r"^##\s+Flow\s*$", body, re.MULTILINE))
    if has_flow and not dot_blocks:
        findings.append(finding("error", "flow-block", "Flow section requires one dot block"))
    if len(dot_blocks) > 1:
        findings.append(finding("warning", "flow-count", "keep one main Flowchart in SKILL.md"))
    flow_nodes: set[str] = set()
    for index, dot in enumerate(dot_blocks, 1):
        if dot.count("{") != dot.count("}"):
            findings.append(finding("error", "dot-braces", f"dot block {index} has unbalanced braces"))
        nodes = {node: attrs for node, attrs in DOT_NODE_RE.findall(dot)}
        flow_nodes.update(node.strip('"') for node in nodes)
        edges = DOT_EDGE_RE.findall(dot)
        if not any("shape=doublecircle" in attrs.replace(" ", "") for attrs in nodes.values()):
            findings.append(finding("error", "dot-terminal", f"dot block {index} has no terminal node"))
        diamonds = [node for node, attrs in nodes.items() if "shape=diamond" in attrs.replace(" ", "")]
        for node in diamonds:
            outgoing = [edge for edge in edges if edge[0] == node]
            if len(outgoing) < 2:
                findings.append(
                    finding("error", "dot-branch", f"decision node {node} needs at least two outgoing edges")
                )
            if any("label=" not in attrs.replace(" ", "") for _, _, attrs in outgoing):
                findings.append(
                    finding("error", "dot-label", f"every outgoing edge from decision node {node} needs a label")
                )

    process = re.search(
        r"^## Process\s*$\n(.*?)(?=^## |\Z)",
        body,
        re.MULTILINE | re.DOTALL,
    )
    if process and flow_nodes:
        groups = re.findall(
            r"^###\s+([A-Z][A-Z0-9]*(?:/[A-Z][A-Z0-9]*)*)\.",
            process.group(1),
            re.MULTILINE,
        )
        process_ids = {node for group in groups for node in group.split("/")}
        unknown = sorted(process_ids - flow_nodes)
        if unknown:
            findings.append(
                finding(
                    "error",
                    "flow-process-id",
                    f"Process headings reference unknown Flow nodes: {unknown}",
                )
            )

    for target in MARKDOWN_LINK_RE.findall(body):
        if target.startswith(("http://", "https://", "#", "mailto:")):
            continue
        clean = target.split("#", 1)[0]
        if clean and not (skill_dir / clean).exists():
            findings.append(finding("error", "broken-link", f"linked resource does not exist: {target}"))

    metrics = {
        "description_chars": len(description_text),
        "lines": lines,
        "words": words,
        "errors": sum(item["level"] == "error" for item in findings),
        "warnings": sum(item["level"] == "warning" for item in findings),
    }
    return findings, metrics


@click.command()
@click.argument("skill_directory", type=click.Path(path_type=Path, exists=True, file_okay=False))
@click.option("--json-output", is_flag=True, help="Emit machine-readable JSON.")
@click.option("-v", "--verbose", is_flag=True, help="Include debug logging.")
def main(skill_directory: Path, json_output: bool, verbose: bool) -> None:
    """Validate SKILL_DIRECTORY against the static Wayne skill contract."""

    logger.remove()
    logger.add(sys.stderr, level="DEBUG" if verbose else "INFO")
    findings, metrics = validate(skill_directory.resolve())
    logger.debug("validated {}", skill_directory.resolve())

    if json_output:
        print(json.dumps({"metrics": metrics, "findings": findings}, indent=2, ensure_ascii=False))
    else:
        print(
            f"{skill_directory}: {metrics.get('errors', 0)} error(s), "
            f"{metrics.get('warnings', 0)} warning(s); "
            f"{metrics.get('description_chars', 0)} description chars, "
            f"{metrics.get('lines', 0)} lines, {metrics.get('words', 0)} words"
        )
        for item in findings:
            print(f"[{item['level'].upper()}] {item['code']}: {item['message']}")

    if metrics.get("errors", 0):
        raise SystemExit(1)


if __name__ == "__main__":
    main()
