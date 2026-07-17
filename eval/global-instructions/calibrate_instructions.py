#!/usr/bin/env python3
"""Calibrate every static global-instruction contract family."""

from __future__ import annotations

import argparse
import tempfile
from pathlib import Path

from check_instructions import CONTRACTS, check


MUTATIONS = {
    "Chinese chat and English files": "Chat with user in Chinese (简体中文). Output files (code, docs, configs, commits) in English.",
    "no implicit commit or branch": "No git commit/branch unless explicitly asked.",
    "uv Python command": "`uv run python` for all Python. Never `.venv/bin/python`.",
    "markdown table boundary": "Tables: markdown only (`| col | col |`). Never ASCII box-drawing.",
    "single state owner": "Every piece of state lives in exactly one place. Many readers, many writers — same storage.",
    "fail-loud configuration": "Missing config / unsupported platform / bad env → crash at startup, not on the Nth user action.",
    "push over polling": "`while True: check_X(); sleep(N)` → there is almost always a better event source.",
    "delete over add": "### Delete > Add",
    "surgical scope": "Touch only what you must.",
    "goal verification": "Define success criteria. Loop until verified.",
    "commit grammar": "1 commit = 1 feature / 1 fix / 1 request / or 1 unit if a feature is really large. No bundles.",
    "human commit identity": "Do NOT add `Co-Authored-By`",
    "Python CLI logging": "All Python scripts use `loguru`:",
    "frontend source": "Read https://github.com/VoltAgent/awesome-design-md FIRST before any UI work. Non-negotiable.",
    "proportional skills": "**Always invoke** when user names a skill or slash command.",
}


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
        for index, (label, literal) in enumerate(MUTATIONS.items(), start=1):
            if literal not in text:
                raise AssertionError(f"mutation source missing for {label}: {literal!r}")
            path = root / f"mutation-{index}.md"
            path.write_text(text.replace(literal, "REMOVED CONTRACT", 1), encoding="utf-8")
            findings = check(path)
            if not any(f"missing {label}:" in finding for finding in findings):
                raise AssertionError(f"mutation {label} escaped: {findings}")
    print(f"PASS: 1 positive and {len(MUTATIONS)} static mutations")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
