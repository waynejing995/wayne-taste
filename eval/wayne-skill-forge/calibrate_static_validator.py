#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.11"
# dependencies = ["click>=8.1", "pyyaml>=6.0"]
# ///
"""Calibrate Forge validation against the official loader-level contract."""

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
description: Performs one local sample procedure when asked.
---

# Sample Skill

Use any clear Markdown organization that helps the agent do the task.
"""


def write(root: Path, text: str, name: str = "sample-skill") -> Path:
    skill = root / name
    skill.mkdir(parents=True)
    (skill / "SKILL.md").write_text(text, encoding="utf-8")
    return skill


def codes(skill: Path) -> set[str]:
    findings, _ = MODULE.validate(skill)
    return {item["code"] for item in findings}


def main() -> int:
    with tempfile.TemporaryDirectory(prefix="forge-loader-calibration-") as temp:
        root = Path(temp)
        assert not codes(write(root / "valid", VALID))

        missing_frontmatter = write(root / "missing", "# Sample\n")
        assert "frontmatter" in codes(missing_frontmatter)

        missing_description = write(
            root / "description",
            VALID.replace(
                "description: Performs one local sample procedure when asked.\n", ""
            ),
        )
        assert "frontmatter-keys" in codes(missing_description)

        supported_metadata = write(
            root / "metadata",
            VALID.replace(
                "description: Performs one local sample procedure when asked.\n",
                "description: Performs one local sample procedure when asked.\n"
                "metadata:\n  owner: wayne\n",
            ),
        )
        assert not codes(supported_metadata), codes(supported_metadata)

        unknown_key = write(
            root / "unknown-key",
            VALID.replace(
                "description: Performs one local sample procedure when asked.\n",
                "description: Performs one local sample procedure when asked.\n"
                "unknown: value\n",
            ),
        )
        assert "frontmatter-keys" in codes(unknown_key)

        bad_name = write(
            root / "bad-name",
            VALID.replace("name: sample-skill", "name: Sample Skill"),
        )
        assert "name" in codes(bad_name)

        mismatch = write(root / "mismatch", VALID, name="different-directory")
        assert "name-directory" in codes(mismatch)

        empty_body = write(
            root / "empty",
            "---\nname: sample-skill\ndescription: Valid description.\n---\n",
        )
        assert "body" in codes(empty_body)

        arbitrary_markdown = write(
            root / "markdown",
            VALID
            + "\n## When to Run Diagnostics\n\n"
            + "## Flow\n\nA prose flow with no DOT block.\n",
        )
        assert not codes(arbitrary_markdown), codes(arbitrary_markdown)

    print(
        "PASS: loader metadata rejects invalid fixtures, accepts supported metadata, "
        "and ignores arbitrary Markdown"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
