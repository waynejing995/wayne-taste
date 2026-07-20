#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.11"
# dependencies = [
#   "click>=8.1",
#   "loguru>=0.7",
#   "pyyaml>=6.0",
# ]
# ///
"""Calibrate the exact Wayne Neat global-owner cleanup."""

from __future__ import annotations

import hashlib
import importlib.util
import subprocess
import tempfile
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
CONTROL = "e16104f1d3749f79b6106043d2b5696e54bb056a"
REMOVED = """## Inherits from ~/.claude/CLAUDE.md

This skill inherits the Wayne control-plane invariants and does NOT redeclare them:

- Language Rules (Chinese to user, English in files)
- Engineering Principles (KISS / YAGNI / DRY / SSoT / Fail-Loud / Push-Don't-Poll / Delete>Add)
- Code Standards
- Behavior Baselines (Think Before / Simplicity / Surgical / Goal-Driven)
- Skill invocation rule (proportional effort)

"""


def git_show(path: str) -> bytes:
    return subprocess.run(
        ["git", "show", f"{CONTROL}:{path}"],
        cwd=ROOT,
        check=True,
        capture_output=True,
    ).stdout


def validator():
    path = ROOT / "wayne-skill-forge/scripts/validate_skill.py"
    spec = importlib.util.spec_from_file_location("validate_skill", path)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def error_codes(module, text: str) -> set[str]:
    with tempfile.TemporaryDirectory(prefix="wayne-neat-calibration-") as temp:
        skill = Path(temp) / "wayne-neat"
        skill.mkdir()
        (skill / "SKILL.md").write_text(text, encoding="utf-8")
        (skill / "references").mkdir()
        (skill / "references/sync-matrix.md").write_bytes(
            (ROOT / "wayne-neat/references/sync-matrix.md").read_bytes()
        )
        findings, _ = module.validate(skill)
    return {item["code"] for item in findings if item["level"] == "error"}


def main() -> int:
    control = git_show("wayne-neat/SKILL.md")
    expected_hash = (ROOT / "eval/wayne-neat/control.sha256").read_text().split()[0]
    assert hashlib.sha256(control).hexdigest() == expected_hash
    assert git_show("wayne-neat/references/sync-matrix.md") == (
        ROOT / "wayne-neat/references/sync-matrix.md"
    ).read_bytes()

    control_text = control.decode()
    assert control_text.count(REMOVED) == 1
    candidate = (ROOT / "wayne-neat/SKILL.md").read_text(encoding="utf-8")
    assert candidate == control_text.replace(REMOVED, "")

    module = validator()
    assert error_codes(module, control_text) == {"inherits"}
    assert not error_codes(module, candidate)
    print("PASS: only the duplicate global-owner block changed; Forge static is clean")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
