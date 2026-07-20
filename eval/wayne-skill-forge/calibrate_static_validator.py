#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.11"
# dependencies = [
#   "click>=8.1",
#   "loguru>=0.7",
#   "pyyaml>=6.0",
# ]
# ///
"""Calibrate Forge's structural validator against semantic-proxy regressions."""

from __future__ import annotations

import importlib.util
import tempfile
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
VALIDATOR = ROOT / "wayne-skill-forge/scripts/validate_skill.py"
SPEC = importlib.util.spec_from_file_location("validate_skill", VALIDATOR)
assert SPEC and SPEC.loader
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)


VALID = """---
name: sample-skill
description: Performs one local sample procedure when asked for sample validation.
---

# Sample Skill

## Flow

```dot
digraph sample {
    A [label="Draft", shape=box];
    B [label="Valid?", shape=diamond];
    R [label="Revise", shape=box];
    X [label="Done", shape=doublecircle];
    A -> B;
    B -> R [label="no"];
    B -> X [label="yes"];
    R -> A;
}
```

## Process

### A. Draft

Read `references/context.md`.

### R. Revise

Repair the observed issue.

### Notes

First local note.

### Notes

Second local note with different context.

## Checklist

- A separate contextual reviewer decides whether this restates the Flow.
"""


def codes(skill: Path) -> set[str]:
    findings, _ = MODULE.validate(skill)
    return {item["code"] for item in findings if item["level"] == "error"}


def write_skill(root: Path, text: str, *, resource: bool = True) -> Path:
    skill = root / "sample-skill"
    skill.mkdir(parents=True)
    (skill / "SKILL.md").write_text(text, encoding="utf-8")
    if resource:
        (skill / "references").mkdir()
        (skill / "references/context.md").write_text("# Context\n", encoding="utf-8")
        (skill / "references/runtime-only.md").write_text(
            "# Conditionally discovered resource\n", encoding="utf-8"
        )
    return skill


def main() -> int:
    with tempfile.TemporaryDirectory(prefix="forge-static-calibration-") as temp:
        root = Path(temp)
        valid = write_skill(root / "valid", VALID)
        assert not codes(valid), codes(valid)

        duplicate = write_skill(root / "duplicate", VALID + "\n## Process\n\nDuplicate.\n")
        assert "duplicate-heading" in codes(duplicate), codes(duplicate)

        unknown = write_skill(
            root / "unknown",
            VALID.replace("### R. Revise", "### Z. Revise"),
        )
        assert "flow-process-id" in codes(unknown), codes(unknown)

        unlabeled = write_skill(
            root / "unlabeled",
            VALID.replace('    B -> R [label="no"];', "    B -> R;"),
        )
        assert "dot-label" in codes(unlabeled), codes(unlabeled)

    print(
        "PASS: repeated H3, Flow+Checklist, and conditional resources are not "
        "semantic-scored; H2, node IDs, and decision edges stay structural"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
