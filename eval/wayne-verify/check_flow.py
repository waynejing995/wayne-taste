#!/usr/bin/env python3
"""Check the directly observable Wayne Verify Flow structure."""

from __future__ import annotations

import argparse
import re
from pathlib import Path


DOT_BLOCK = re.compile(r"```dot\s*\n(.*?)\n```", re.DOTALL)
NODE = re.compile(r'^\s*([A-Z])\s*\[label="([^"]+)",\s*shape=([a-z]+)]\s*;', re.MULTILINE)
EDGE = re.compile(
    r'^\s*([A-Z])\s*->\s*([A-Z])(?:\s*\[label="([^"]+)"])?\s*;',
    re.MULTILINE,
)


def validate(path: Path) -> list[str]:
    text = path.read_text(encoding="utf-8")
    match = DOT_BLOCK.search(text)
    if not match:
        return ["missing Flow dot block"]
    graph = match.group(1)
    nodes = {node: (label, shape) for node, label, shape in NODE.findall(graph)}
    edges = {(source, target, label or "") for source, target, label in EDGE.findall(graph)}
    findings: list[str] = []
    if nodes.get("K") != ("Record legitimate skip", "box"):
        findings.append("Flow K must be the Record legitimate skip action")
    required = {
        ("B", "X", "missing / invalid skip"),
        ("B", "K", "legitimate skip"),
        ("B", "C", "yes"),
        ("K", "M", ""),
    }
    missing = sorted(required - edges)
    if missing:
        findings.append(f"Flow legitimate-skip branch missing edges: {missing}")
    return findings


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("skill", type=Path)
    args = parser.parse_args()
    findings = validate(args.skill / "SKILL.md")
    if findings:
        for finding in findings:
            print(f"FAIL: {finding}")
        return 1
    print("PASS: legitimate-skip Flow branch")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
