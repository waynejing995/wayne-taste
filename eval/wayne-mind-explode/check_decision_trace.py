#!/usr/bin/env python3
"""Check that each decision-log write makes exactly one new decision durable."""

from __future__ import annotations

import argparse
import json
import re
from pathlib import Path
from typing import Any, Iterator


DECISION_PATH = re.compile(r"(?:^|/)docs/decisions/[^/]+-decisions\.md$")
ROW = re.compile(r"^[+ ]?\|\s*(\d+)\s*\|", re.MULTILINE)


def row_ids(text: str) -> set[int]:
    return {int(value) for value in ROW.findall(text)}


def codex_batches(text: str) -> list[list[int]]:
    batches: list[list[int]] = []
    seen: set[int] = set()
    for chunk in re.split(r"(?m)^apply patch\s*$", text)[1:]:
        if not re.search(r"(?m)^patch: completed\s*$", chunk):
            continue
        prefix = chunk.split("diff --git", 1)[0]
        paths = [line.strip() for line in prefix.splitlines() if DECISION_PATH.search(line.strip())]
        if not paths:
            continue
        current = row_ids(chunk)
        added = sorted(current - seen)
        seen.update(current)
        if added:
            batches.append(added)
    return batches


def walk(value: Any) -> Iterator[dict[str, Any]]:
    if isinstance(value, dict):
        yield value
        for child in value.values():
            yield from walk(child)
    elif isinstance(value, list):
        for child in value:
            yield from walk(child)


def claude_batches(text: str) -> list[list[int]]:
    batches: list[list[int]] = []
    seen_rows: set[int] = set()
    seen_tools: set[str] = set()
    for line in text.splitlines():
        try:
            payload = json.loads(line)
        except json.JSONDecodeError:
            continue
        for item in walk(payload):
            if item.get("type") != "tool_use" or not isinstance(item.get("input"), dict):
                continue
            tool_id = str(item.get("id", ""))
            if tool_id and tool_id in seen_tools:
                continue
            seen_tools.add(tool_id)
            tool_input = item["input"]
            path = str(tool_input.get("file_path") or tool_input.get("path") or "")
            if not DECISION_PATH.search(path):
                continue
            content = "\n".join(
                str(tool_input.get(key, "")) for key in ("content", "new_string", "patch")
            )
            current = row_ids(content)
            added = sorted(current - seen_rows)
            seen_rows.update(current)
            if added:
                batches.append(added)
    return batches


def validate_batches(batches: list[list[int]]) -> list[str]:
    findings: list[str] = []
    if not batches:
        return ["no observable durable decision-log append events"]
    for index, batch in enumerate(batches, 1):
        if len(batch) != 1:
            findings.append(f"write event {index} appended {len(batch)} decisions: {batch}")
    flattened = [decision for batch in batches for decision in batch]
    if len(flattened) < 2:
        findings.append(f"staged case observed only {len(flattened)} decision append")
    if flattened and flattened != list(range(1, max(flattened) + 1)):
        findings.append(f"decision append sequence is not exactly 1..N: {flattened}")
    return findings


def validate_trace(path: Path, provider: str = "auto") -> list[str]:
    text = path.read_text(encoding="utf-8")
    if provider == "auto":
        provider = "claude" if path.suffix == ".jsonl" else "codex"
    batches = claude_batches(text) if provider == "claude" else codex_batches(text)
    return validate_batches(batches)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("trace", type=Path)
    parser.add_argument("--provider", choices=("auto", "claude", "codex"), default="auto")
    args = parser.parse_args()
    findings = validate_trace(args.trace, args.provider)
    if findings:
        for finding in findings:
            print(f"FAIL: {finding}")
        return 1
    print("PASS: one durable append per decision")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
