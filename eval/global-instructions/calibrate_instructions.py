#!/usr/bin/env python3
"""Calibrate every independent shared global-instruction static invariant."""

from __future__ import annotations

import argparse
import tempfile
from pathlib import Path

from check_instructions import check


MUTATIONS: list[tuple[str, str]] = [
    ("Chinese chat and English files", "Chat with user in Chinese (简体中文)."),
    ("Chinese chat and English files", "Output files (code, docs, configs, commits) in English."),
    ("no implicit commit or branch", "No git commit/branch unless explicitly asked."),
    ("uv Python command", "`uv run python` for all Python."),
    ("uv Python command", "Never `.venv/bin/python`."),
    ("markdown table boundary", "Tables: markdown only (`| col | col |`)."),
    ("markdown table boundary", "Never ASCII box-drawing."),
    ("single state owner", "Every piece of state lives in exactly one place."),
    ("single state owner", "All derived views (UI, cache, index, replicas) MUST be reconstructible from the SSoT."),
    ("fail-loud configuration", "Fail Loud"),
    ("fail-loud configuration", "Missing config / unsupported platform / bad env → crash at startup, not on the Nth user action."),
    ("fail-loud configuration", "Silent degradation"),
    ("push over polling", "Push, Don't Poll"),
    ("push over polling", "events/reactive/callbacks"),
    ("push over polling", "`while True: check_X(); sleep(N)`"),
    ("delete over add", "Delete > Add"),
    ("surgical scope", "Touch only what you must."),
    ("goal verification", "Define success criteria."),
    ("goal verification", "Loop until verified."),
    ("commit grammar", "[why]"),
    ("commit grammar", "[how]"),
    ("commit grammar", "git commit -s"),
    ("commit grammar", "1 commit = 1 feature"),
    ("human commit identity", "Jingwen Chen <Jingwen.Chen2@amd.com>"),
    ("human commit identity", "Do NOT add `Co-Authored-By`"),
    ("Python CLI logging", "All Python scripts use `loguru`"),
    ("Python CLI logging", "`-v` flag shows `DEBUG`"),
    ("frontend source", "https://github.com/VoltAgent/awesome-design-md"),
    ("frontend source", "FIRST before any UI work"),
    ("proportional skills", "proportional effort"),
    ("proportional skills", "Trivial | Just do it. No skill."),
    ("proportional skills", "Always invoke"),
    ("Occam RCA convergence", "Occam"),
    ("Occam RCA convergence", "search heuristic"),
    ("Occam RCA convergence", "explains ALL observations + reproduces + sibling paths"),
    ("decision question language", "Before `AskUserQuestion` on complex problems: explain in plain Chinese."),
    ("forbidden browser surface", "Never use `mcp__claude-in-chrome__*`"),
    ("personal KB path", "/mnt/share/wayne-note/"),
]


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("instructions", type=Path)
    args = parser.parse_args()
    source = args.instructions.resolve()
    positive = check(source)
    if positive:
        raise AssertionError(f"positive instructions fail: {positive}")
    text = source.read_text(encoding="utf-8")
    with tempfile.TemporaryDirectory(prefix="global-instructions-static-") as temp:
        root = Path(temp)
        for index, (label, literal) in enumerate(MUTATIONS, start=1):
            if literal not in text:
                raise AssertionError(f"mutation source missing for {label}: {literal!r}")
            path = root / f"mutation-{index}.md"
            path.write_text(text.replace(literal, "REMOVED CONTRACT"), encoding="utf-8")
            findings = check(path)
            if not any(f"missing {label}:" in finding for finding in findings):
                raise AssertionError(f"mutation {index} {label} escaped: {findings}")
    print(f"PASS: 1 positive and {len(MUTATIONS)} independent static mutations")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
