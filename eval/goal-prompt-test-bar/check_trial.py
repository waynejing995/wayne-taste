#!/usr/bin/env python3
"""Deterministic gate for one writer trial: fixture untouched, a goal block exists,
and the block fits 4,000 characters. Test-bar meaning is the blind judge's job."""

from __future__ import annotations

import argparse
import json
import re
import subprocess
from pathlib import Path

LIMIT = 4000
FENCE = re.compile(r"```[^\n]*\n(.*?)```", re.S)


def goal_block(text: str) -> str:
    """The fenced block holding `Goal:`, else `Goal:` up to the first CJK-only line."""
    for body in FENCE.findall(text):
        if re.search(r"(?m)^\s*Goal:", body):
            return body.strip()
    start = re.search(r"(?m)^\s*Goal:", text)
    if not start:
        return ""
    lines = text[start.start():].splitlines()
    kept: list[str] = []
    for line in lines:
        if re.search(r"[\u4e00-\u9fff]", line) and not re.search(r"[A-Za-z]{4,}", line):
            break
        kept.append(line)
    return "\n".join(kept).strip()


def fs_hashes(fs: Path) -> str:
    out = subprocess.run(
        "find . -path '*/.git' -prune -o -type f -print0 | sort -z | xargs -0 sha256sum",
        shell=True, cwd=fs, check=True, capture_output=True, text=True,
    )
    return out.stdout


def check(workspace: Path) -> dict:
    findings: list[str] = []
    before = (workspace / "fs-before.sha256").read_text(encoding="utf-8")
    if fs_hashes(workspace / "fs") != before:
        findings.append("writer mutated the fixture filesystem")
    final = workspace / "final.md"
    text = final.read_text(encoding="utf-8").strip() if final.is_file() else ""
    block = goal_block(text)
    if not text:
        findings.append("no final response")
    elif not block:
        findings.append("no goal block")
    elif len(block) > LIMIT:
        findings.append(f"goal block is {len(block)} characters (> {LIMIT})")
    return {"pass": not findings, "findings": findings, "goal_chars": len(block)}


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("workspace", type=Path)
    args = parser.parse_args()
    result = check(args.workspace.resolve())
    print(json.dumps(result, ensure_ascii=False))
    return 0 if result["pass"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
