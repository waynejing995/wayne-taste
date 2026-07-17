#!/usr/bin/env python3
"""Static intent guard for a Wayne Test Design candidate tree."""

from __future__ import annotations

import argparse
import re
from pathlib import Path


E_HEADER = "| # | User path | Env: process | Env: data | Env: entrypoint | Observable (pass = ?) | Status |"
U_MARKER = "U-SEED (wayne-plan re-authors + locks)"


def check(skill_dir: Path) -> list[str]:
    findings: list[str] = []
    skill_path = skill_dir / "SKILL.md"
    template_path = skill_dir / "templates/test-matrix-template.md"
    if not skill_path.is_file() or not template_path.is_file():
        return ["candidate skill or template missing"]
    skill = skill_path.read_text(encoding="utf-8")
    template = template_path.read_text(encoding="utf-8")
    lower = skill.lower()

    required = {
        "converged direct request input and upstream route": (
            "converged direct request" in lower and "route unconverged intent upstream" in lower
        ),
        "test-relevant decision coverage": "test-relevant decision" in lower,
        "row-level KB lesson trace": "cite each matched lesson in its row" in lower,
        "verbatim table-or-none absorption and extension": (
            "e2e table or `e2e: none — <reason>`" in lower
            and "absorb that" in lower
            and "verbatim exactly once" in lower
            and "extend any missing observable paths" in lower
        ),
        "unstable U-SEED explicit-none path": (
            U_MARKER in skill and "U-SEED: none — <reason>" in skill
        ),
        "default dated sequence path": (
            "docs/test-matrix/YYYY-MM-DD-NNN-<descriptive-name>-test-matrix.md" in skill
            and "next unused" in lower
        ),
        "fixed runtime location contract": (
            "fixed host, port, database, cwd, or main worktree" in lower
            and "`env: process`" in lower
        ),
        "unresolved conflict blocked terminal": (
            'K [label="Write blocked matrix; no plan handoff", shape=doublecircle]' in skill
            and 'I -> K [label="yes"]' in skill
        ),
        "mind-explode return-only route": (
            'J [label="Invoked by mind-explode?", shape=diamond]' in skill
            and 'J -> M [label="yes"]' in skill
            and "do not auto-advance" in lower
        ),
        "standalone plan handoff route": (
            'J -> W [label="no"]' in skill
            and "only a\nstandalone, unblocked run hands the artifact to `wayne-plan`" in lower
        ),
        "exact template U-SEED heading": f"### {U_MARKER}" in template,
        "template behavior-seed owner": "| # | Behavior seed | Dimension |" in template,
        "exact template E2E header": E_HEADER in template,
        "empty E2E keeps header": "always emit the locked header" in lower,
    }
    for name, present in required.items():
        if not present:
            findings.append(f"missing intent: {name}")

    for forbidden in ("TaskCreate", "~/.claude/skills", "gstack"):
        if forbidden.lower() in lower:
            findings.append(f"forbidden agent-specific mechanism: {forbidden}")
    if not re.search(r"write only after approval", lower):
        findings.append("missing approval-before-write gate")
    return findings


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("skill_dir", type=Path)
    args = parser.parse_args()
    findings = check(args.skill_dir.resolve())
    if findings:
        for finding in findings:
            print(f"FAIL: {finding}")
        return 1
    print("PASS: candidate static intent")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
