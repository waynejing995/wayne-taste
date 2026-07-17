#!/usr/bin/env python3
"""Validate artifact-local Wayne goal-prompt invariants."""

from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path


REQUIRED = (
    "Goal:",
    "Context:",
    "Tasks:",
    "Verification required before completion:",
    "Completion criteria:",
)
HEADING_PATTERNS = {
    "Goal:": r"(?m)^Goal:\s+\S.*$",
    "Context:": r"(?m)^Context:\s*$",
    "Tasks:": r"(?m)^Tasks:\s*$",
    "Verification required before completion:": (
        r"(?m)^Verification required before completion:\s*$"
    ),
    "Completion criteria:": r"(?m)^Completion criteria:\s*$",
}


def validate(text: str, correcting: bool) -> list[str]:
    findings: list[str] = []
    if len(text) > 4000:
        findings.append(f"goal exceeds 4000 characters: {len(text)}")
    positions: list[int] = []
    for heading in REQUIRED:
        count = len(re.findall(HEADING_PATTERNS[heading], text))
        if count != 1:
            findings.append(f"{heading} count is {count}, expected 1")
        positions.append(text.find(heading))
    if all(position >= 0 for position in positions) and positions != sorted(positions):
        findings.append("required sections are out of order")
    correction_count = len(re.findall(r"(?m)^Current correction:\s*$", text))
    expected = 1 if correcting else 0
    if correction_count != expected:
        findings.append(
            f"Current correction count is {correction_count}, expected {expected}"
        )
    verification = text[text.find(REQUIRED[3]) : text.find(REQUIRED[4])]
    if not re.search(r"`[^`\n]+`", verification):
        findings.append("verification section has no exact backticked command")
    if re.search(r"(?i)\brun (?:the )?tests\b|works well|looks good|更好看", text):
        findings.append("goal contains vague verification or completion language")
    return findings


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("goal", help="goal file or - for stdin")
    parser.add_argument("--correcting", action="store_true")
    args = parser.parse_args()
    text = sys.stdin.read() if args.goal == "-" else Path(args.goal).read_text(encoding="utf-8")
    findings = validate(text, args.correcting)
    if findings:
        for finding in findings:
            print(f"FAIL: {finding}")
        return 1
    print("PASS: goal prompt artifact contract")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
