#!/usr/bin/env python3
"""Check machine-facing resources and collect prose observations."""

from __future__ import annotations

import argparse
import json
import re
from pathlib import Path


REQUIRED = (
    "references/goal-prompt-template.md",
    "references/example-alfred-tui.md",
    "references/dispatch-runtime.md",
    "scripts/codex-dispatch.sh",
    "scripts/codex_goal_driver.py",
)
BODY_OBSERVATIONS = {
    "six-section contract": r"Verification required before completion.*Completion criteria",
    "length ceiling": r"4,000 characters",
    "one question": r"ask exactly one Chinese question",
    "plan SSoT": r"plan already owns the work.*SSoT",
    "real path": r"real entrypoint.*fake substitute",
    "confirmation": r"whether the goal is correct.*cwd",
    "pre-confirm stop": r"do not write a goal file.*dispatch",
    "project-local goal": r"goal-<slug>\.md.*target project",
    "startup failure": r"DISPATCH_FAILED.*driver log",
    "resume": r"paused/blocked goal.*same live thread.*resume",
    "JSONL monitor": r"JSONL stream.*do not scrape a TUI",
}
RUNTIME_OBSERVATIONS = (
    "thread/start",
    "thread/goal/set",
    "turn/start",
    "thread/inject_items",
    "danger-full-access",
    "approvalPolicy: never",
    "paused",
    "blocked",
    "usageLimited",
    "budgetLimited",
)


def read(root: Path, relative: str) -> str:
    path = root / relative
    return path.read_text(encoding="utf-8") if path.is_file() else ""


def check(root: Path) -> list[str]:
    """Return hard findings for files consumed by the loader or runtime."""
    findings: list[str] = []
    skill = root / "SKILL.md"
    if not skill.is_file():
        return ["missing SKILL.md"]
    for relative in REQUIRED:
        if not read(root, relative).strip():
            findings.append(f"missing required resource: {relative}")
    return findings


def observe(root: Path) -> list[str]:
    """Return lexical clues for the blind AI reviewer, never a verdict."""
    observations: list[str] = []
    skill = root / "SKILL.md"
    if not skill.is_file():
        return observations
    body = skill.read_text(encoding="utf-8")
    for relative in REQUIRED:
        if relative not in body:
            observations.append(f"SKILL.md does not visibly reference: {relative}")
    normalized = re.sub(r"\s+", " ", body)
    for label, pattern in BODY_OBSERVATIONS.items():
        if not re.search(pattern, normalized, re.IGNORECASE):
            observations.append(f"body wording does not surface: {label}")
    if re.search(r"(?im)^## (?:Inherits|When to Run)\b", body):
        observations.append("body may contain copied global/routing guidance")
    for literal in (
        "thread/start",
        "thread/goal/set",
        "turn/start",
        "thread/inject_items",
        "RTM_NEWADDR",
    ):
        if literal in body:
            observations.append(f"body visibly inlines runtime protocol detail: {literal}")
    if "gstack" in "\n".join(
        path.read_text(encoding="utf-8", errors="ignore")
        for path in root.rglob("*")
        if path.is_file()
    ).lower():
        observations.append("candidate text mentions the forbidden gstack dependency")

    runtime = read(root, "references/dispatch-runtime.md")
    for literal in RUNTIME_OBSERVATIONS:
        if literal not in runtime:
            observations.append(f"runtime reference does not visibly mention: {literal}")
    return observations


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("candidate", type=Path)
    args = parser.parse_args()
    root = args.candidate.resolve()
    hard_findings = check(root)
    result = {
        "machine_verdict": "FAIL" if hard_findings else "PASS",
        "semantic_verdict": "AI_REVIEW_REQUIRED",
        "hard_findings": hard_findings,
        "observations": observe(root),
    }
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 1 if hard_findings else 0


if __name__ == "__main__":
    raise SystemExit(main())
