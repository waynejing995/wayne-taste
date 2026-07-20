#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.11"
# dependencies = [
#   "click>=8.1",
#   "loguru>=0.7",
#   "pyyaml>=6.0",
# ]
# ///
"""Calibrate Distill's global-owner and intake-gate repair."""

from __future__ import annotations

import hashlib
import importlib.util
import subprocess
import tempfile
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
CONTROL = "708779ef56efcf7df59cd90a41925d2e66d9aa87"


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
    with tempfile.TemporaryDirectory(prefix="wayne-distill-calibration-") as temp:
        skill = Path(temp) / "wayne-distill"
        skill.mkdir()
        (skill / "SKILL.md").write_text(text, encoding="utf-8")
        findings, _ = module.validate(skill)
    return {item["code"] for item in findings if item["level"] == "error"}


def main() -> int:
    pins = {}
    for line in (ROOT / "eval/wayne-distill/control.sha256").read_text().splitlines():
        digest, label = line.split(maxsplit=1)
        pins[label.split("@", 1)[0]] = digest

    control = git_show("wayne-distill/SKILL.md")
    script = ROOT / "wayne-distill/scripts/scan_sessions.py"
    assert hashlib.sha256(control).hexdigest() == pins["wayne-distill/SKILL.md"]
    assert hashlib.sha256(script.read_bytes()).hexdigest() == pins[
        "wayne-distill/scripts/scan_sessions.py"
    ]
    assert script.read_bytes() == git_show("wayne-distill/scripts/scan_sessions.py")

    module = validator()
    assert error_codes(module, control.decode()) == {"inherits", "when-to-run"}
    candidate = (ROOT / "wayne-distill/SKILL.md").read_text(encoding="utf-8")
    assert not error_codes(module, candidate)
    assert "## Inherits from" not in candidate
    assert "## When to Run" not in candidate
    assert "`/wayne-distill <keyword>` narrows" in candidate
    assert "Do not lower thresholds to manufacture" in candidate

    dot = module.DOT_BLOCK_RE.findall(candidate)[0]
    edges = {(left, right, attrs) for left, right, attrs in module.DOT_EDGE_RE.findall(dot)}
    gate = '"Enough history or new evidence?"'
    assert (gate, '"Stop: keep evidence threshold"', 'label="no"') in edges
    assert any(left == gate and "scan_sessions.py" in right and 'label="yes"' in attrs for left, right, attrs in edges)
    print("PASS: ownership is single; focus input and threshold stop are explicit")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
