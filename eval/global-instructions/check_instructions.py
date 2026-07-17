#!/usr/bin/env python3
"""Static local-contract checker for a shared global instruction candidate."""

from __future__ import annotations

import argparse
import re
from pathlib import Path


CONTRACTS: dict[str, tuple[str, ...]] = {
    "Chinese chat and English files": (
        r"chat[^\n]{0,50}Chinese",
        r"(?:output|write)[^\n]{0,60}(?:files|code|docs|configs?)[^\n]{0,40}English",
    ),
    "no implicit commit or branch": (
        r"no git commit/branch unless explicitly asked",
    ),
    "uv Python command": (r"`uv run python`", r"never `?\.venv/bin/python"),
    "markdown table boundary": (r"tables?: markdown only", r"never ASCII box"),
    "single state owner": (
        r"every piece of state (?:lives|has|is owned)[^\n]{0,50}(?:exactly )?one",
        r"derived views[^\n]{0,80}reconstruct",
    ),
    "fail-loud configuration": (
        r"fail loud",
        r"missing config[^\n]{0,80}(?:crash|fail|raise)",
        r"silent degrad",
    ),
    "push over polling": (
        r"push, don't poll",
        r"events?/reactive/callback",
        r"while True[^\n]{0,80}sleep",
    ),
    "delete over add": (r"delete\s*>\s*add",),
    "surgical scope": (r"touch only what you must",),
    "goal verification": (r"define success criteria", r"loop until verified"),
    "commit grammar": (
        r"\[why\]",
        r"\[how\]",
        r"git commit -s",
        r"1 commit = 1 feature",
    ),
    "human commit identity": (
        r"Jingwen Chen <Jingwen\.Chen2@amd\.com>",
        r"do NOT add `Co-Authored-By`",
    ),
    "Python CLI logging": (r"Python scripts use `loguru`", r"-v[^\n]{0,40}DEBUG"),
    "frontend source": (
        r"https://github\.com/VoltAgent/awesome-design-md",
        r"FIRST before any UI work",
    ),
    "proportional skills": (
        r"proportional effort",
        r"trivial[^\n]{0,40}no skill",
        r"always invoke[^\n]{0,50}user names a skill",
    ),
    "Occam RCA convergence": (
        r"Occam",
        r"search heuristic[^\n]{0,100}(?:NOT|not)[^\n]{0,30}stop condition",
        r"explains ALL observations[^\n]{0,80}reproduces[^\n]{0,80}sibling paths",
    ),
    "decision question language": (
        r"Before `AskUserQuestion`[^\n]{0,100}plain Chinese",
    ),
    "forbidden browser surface": (r"Never use `mcp__claude-in-chrome__\*`",),
    "personal KB path": (r"/mnt/share/wayne-note/",),
}


def check(path: Path) -> list[str]:
    text = path.read_text(encoding="utf-8")
    findings: list[str] = []
    if not text.strip():
        return ["instruction candidate is empty"]
    for label, patterns in CONTRACTS.items():
        for pattern in patterns:
            if not re.search(pattern, text, re.IGNORECASE):
                findings.append(f"missing {label}: /{pattern}/")
    return findings


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("instructions", type=Path)
    args = parser.parse_args()
    findings = check(args.instructions.resolve())
    if findings:
        for finding in findings:
            print(f"FAIL: {finding}")
        return 1
    print("PASS: global instruction static contract")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
