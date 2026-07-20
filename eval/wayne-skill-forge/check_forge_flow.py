#!/usr/bin/env python3
"""Check and calibrate the directly observable Forge static gate."""

from __future__ import annotations

import argparse
import re
import tempfile
from pathlib import Path


DOT_BLOCK = re.compile(r"```dot\s*\n(.*?)\n```", re.DOTALL)
NODE = re.compile(
    r'^\s*([A-Z])\s*\[label="([^"]+)",\s*shape=([a-z]+)]\s*;',
    re.MULTILINE,
)
EDGE = re.compile(
    r'^\s*([A-Z])\s*->\s*([A-Z])(?:\s*\[label="([^"]+)"])?\s*;',
    re.MULTILINE,
)


def validate(path: Path) -> list[str]:
    text = path.read_text(encoding="utf-8")
    match = DOT_BLOCK.search(text)
    if not match:
        return ["missing Forge Flow dot block"]
    graph = match.group(1)
    nodes = {node: (label, shape) for node, label, shape in NODE.findall(graph)}
    edges = {(source, target, label or "") for source, target, label in EDGE.findall(graph)}
    findings: list[str] = []
    if nodes.get("V") != ("Static validation passes?", "diamond"):
        findings.append("Flow V must be the static-validation decision")
    required = {
        ("E", "V", ""),
        ("V", "R", "no"),
        ("V", "F", "yes"),
    }
    missing = sorted(required - edges)
    if missing:
        findings.append(f"static gate missing edges: {missing}")
    if ("E", "F", "") in edges:
        findings.append("static validation bypasses its decision gate")
    return findings


def calibrate(path: Path) -> list[str]:
    findings = validate(path)
    if findings:
        return [f"valid Forge failed: {findings}"]
    text = path.read_text(encoding="utf-8")
    mutations = {
        "missing decision": text.replace(
            '    V [label="Static validation passes?", shape=diamond];\n', ""
        ),
        "missing failure edge": text.replace('    V -> R [label="no"];\n', ""),
        "missing success edge": text.replace('    V -> F [label="yes"];\n', ""),
        "static bypass": text.replace('    E -> V;\n', '    E -> V;\n    E -> F;\n'),
    }
    with tempfile.TemporaryDirectory(prefix="forge-flow-calibration-") as temp:
        root = Path(temp)
        for label, mutated in mutations.items():
            candidate = root / f"{label.replace(' ', '-')}.md"
            candidate.write_text(mutated, encoding="utf-8")
            if not validate(candidate):
                findings.append(f"{label} mutation escaped")
    return findings


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("skill", type=Path)
    parser.add_argument("--calibrate", action="store_true")
    args = parser.parse_args()
    path = args.skill / "SKILL.md"
    findings = calibrate(path) if args.calibrate else validate(path)
    if findings:
        for finding in findings:
            print(f"FAIL: {finding}")
        return 1
    suffix = " and 4 mutations" if args.calibrate else ""
    print(f"PASS: Forge static-validation Flow gate{suffix}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
