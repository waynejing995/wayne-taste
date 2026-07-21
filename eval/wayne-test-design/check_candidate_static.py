#!/usr/bin/env python3
"""Check machine-observable Wayne Test Design candidate resources."""

from __future__ import annotations

import argparse
import json
from pathlib import Path


def hard_check(skill_dir: Path) -> list[str]:
    skill_path = skill_dir / "SKILL.md"
    template_path = skill_dir / "templates/test-matrix-template.md"
    if not skill_path.is_file() or not template_path.is_file():
        return ["candidate skill or template missing"]
    return []


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("skill_dir", type=Path)
    args = parser.parse_args()
    skill_dir = args.skill_dir.resolve()
    hard_findings = hard_check(skill_dir)
    result = {
        "machine_verdict": "FAIL" if hard_findings else "PASS",
        "semantic_verdict": "AI_REVIEW_REQUIRED",
        "hard_findings": hard_findings,
        "observations": [],
    }
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 1 if hard_findings else 0


if __name__ == "__main__":
    raise SystemExit(main())
