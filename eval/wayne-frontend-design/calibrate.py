#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.11"
# dependencies = [
#   "click>=8.1",
#   "loguru>=0.7",
#   "pyyaml>=6.0",
# ]
# ///
"""Calibrate the exact frontend global-owner cleanup."""

from __future__ import annotations

import hashlib
import importlib.util
import subprocess
import tempfile
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
CONTROL = "2038108b323e5c536516f03bcaca851cdca84574"
REMOVED = """## Inherits from ~/.claude/CLAUDE.md

This skill inherits the Wayne control-plane invariants and does not redeclare them. The following are assumed and MUST NOT be repeated below:

- Language Rules (Chinese to user, English to files)
- Engineering Principles (KISS / YAGNI / DRY / SSoT / Fail-Loud / Push-Don't-Poll / Delete>Add)
- Code Standards (uv run python, markdown tables)
- Behavior Baselines (Think Before / Simplicity / Surgical / Goal-Driven)
- Skill invocation rule (proportional effort)
- Frontend mandate (read VoltAgent awesome-design-md FIRST — see CLAUDE.md `## Frontend`)

This skill only specifies the UI design / build / verify workflow.

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
    with tempfile.TemporaryDirectory(prefix="frontend-design-calibration-") as temp:
        skill = Path(temp) / "wayne-frontend-design"
        skill.mkdir()
        (skill / "SKILL.md").write_text(text, encoding="utf-8")
        (skill / "references").symlink_to(ROOT / "wayne-frontend-design/references")
        findings, _ = module.validate(skill)
    return {item["code"] for item in findings if item["level"] == "error"}


def reference_paths() -> list[str]:
    output = subprocess.run(
        ["git", "ls-tree", "-r", "--name-only", CONTROL, "wayne-frontend-design/references"],
        cwd=ROOT,
        check=True,
        capture_output=True,
        text=True,
    ).stdout
    return [line for line in output.splitlines() if line]


def main() -> int:
    control = git_show("wayne-frontend-design/SKILL.md")
    expected_hash = (ROOT / "eval/wayne-frontend-design/control.sha256").read_text().split()[0]
    assert hashlib.sha256(control).hexdigest() == expected_hash
    for path in reference_paths():
        assert (ROOT / path).read_bytes() == git_show(path), path

    control_text = control.decode()
    assert control_text.count(REMOVED) == 1
    candidate = (ROOT / "wayne-frontend-design/SKILL.md").read_text(encoding="utf-8")
    assert candidate == control_text.replace(REMOVED, "")

    module = validator()
    assert error_codes(module, control_text) == {"inherits"}
    assert not error_codes(module, candidate)
    print("PASS: only the duplicate global-owner block changed; references are identical")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
