#!/usr/bin/env python3
"""Static intent checker for a Wayne Goal Prompt candidate."""

from __future__ import annotations

import argparse
import re
from pathlib import Path


REQUIRED = (
    "references/goal-prompt-template.md",
    "references/example-alfred-tui.md",
    "references/dispatch-runtime.md",
    "scripts/codex-dispatch.sh",
    "scripts/codex_goal_driver.py",
    "scripts/validate_goal_prompt.py",
)
BODY_PATTERNS = {
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
RUNTIME_LITERALS = (
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


def check(root: Path) -> list[str]:
    findings: list[str] = []

    def read(relative: str) -> str:
        path = root / relative
        return path.read_text(encoding="utf-8") if path.is_file() else ""

    skill = root / "SKILL.md"
    if not skill.is_file():
        return ["missing SKILL.md"]
    text = skill.read_text(encoding="utf-8")
    parts = text.split("---", 2)
    if len(parts) != 3:
        return ["invalid frontmatter"]
    front = parts[1]
    body = parts[2]
    keys = re.findall(r"(?m)^([a-z][a-z0-9_-]*):", front)
    if keys != ["name", "description"]:
        findings.append(f"frontmatter keys differ: {keys}")
    if "name: wayne-goal-prompt" not in front:
        findings.append("frontmatter name mismatch")
    for relative in REQUIRED:
        if not read(relative).strip():
            findings.append(f"missing required resource: {relative}")
        if relative not in body:
            findings.append(f"SKILL.md does not reference: {relative}")
    normalized = re.sub(r"\s+", " ", body)
    for label, pattern in BODY_PATTERNS.items():
        if not re.search(pattern, normalized, re.IGNORECASE):
            findings.append(f"body omits {label}")
    if re.search(r"(?im)^## (?:Inherits|When to Run)\b", body):
        findings.append("body contains copied global/routing section")
    for literal in ("thread/start", "thread/goal/set", "turn/start", "thread/inject_items", "RTM_NEWADDR"):
        if literal in body:
            findings.append(f"body inlines runtime protocol detail: {literal}")
    if "gstack" in "\n".join(
        path.read_text(encoding="utf-8", errors="ignore")
        for path in root.rglob("*")
        if path.is_file()
    ).lower():
        findings.append("candidate references forbidden dependency")

    runtime = read("references/dispatch-runtime.md")
    for literal in RUNTIME_LITERALS:
        if literal not in runtime:
            findings.append(f"runtime reference omits {literal}")
    shell = read("scripts/codex-dispatch.sh")
    for literal in ("resume)", "WAYNE_DISPATCH_STARTUP_TIMEOUT", "control/ready", "resume.request"):
        if literal not in shell:
            findings.append(f"dispatch shell omits {literal}")
    driver = read("scripts/codex_goal_driver.py")
    for literal in ("RESUMABLE", "resume.request", '"status": "active"', '"thread/inject_items"'):
        if literal not in driver:
            findings.append(f"goal driver omits {literal}")
    return findings


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("candidate", type=Path)
    args = parser.parse_args()
    findings = check(args.candidate.resolve())
    if findings:
        for finding in findings:
            print(f"FAIL: {finding}")
        return 1
    print("PASS: wayne-goal-prompt candidate static contract")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
