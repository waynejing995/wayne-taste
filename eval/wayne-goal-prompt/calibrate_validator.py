#!/usr/bin/env python3
"""Calibrate the candidate goal artifact validator."""

from __future__ import annotations

import argparse
import subprocess
import tempfile
from pathlib import Path


VALID = """Goal: Ship the retry behavior.

Context:
- Do not change the public API.

Tasks:
1. Implement the retry behavior.

Verification required before completion:
- `uv run --no-project python -m unittest -v`

Completion criteria:
- The named unittest command passes.
"""


def execute(script: Path, text: str, correcting: bool = False) -> subprocess.CompletedProcess[str]:
    command = ["uv", "run", "--no-project", "python", str(script), "-"]
    if correcting:
        command.append("--correcting")
    return subprocess.run(command, input=text, check=False, capture_output=True, text=True)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("candidate", type=Path)
    args = parser.parse_args()
    script = args.candidate.resolve() / "scripts/validate_goal_prompt.py"
    positive = execute(script, VALID)
    if positive.returncode != 0:
        raise AssertionError(f"valid goal failed: {positive.stdout}{positive.stderr}")
    correction = VALID.replace("Tasks:", "Current correction:\n- Previous run used the wrong path.\n\nTasks:")
    if execute(script, correction, True).returncode != 0:
        raise AssertionError("valid correction goal failed")

    mutations = {
        "missing-goal": (VALID.replace("Goal:", "Outcome:"), "Goal: count"),
        "missing-context": (VALID.replace("Context:", "Background:"), "Context: count"),
        "missing-tasks": (VALID.replace("Tasks:", "Steps:"), "Tasks: count"),
        "missing-verification": (
            VALID.replace("Verification required before completion:", "Verification:"),
            "Verification required before completion: count",
        ),
        "missing-completion": (
            VALID.replace("Completion criteria:", "Done:"),
            "Completion criteria: count",
        ),
        "wrong-order": (
            VALID.replace("Tasks:", "TEMP:")
            .replace("Verification required before completion:", "Tasks:")
            .replace("TEMP:", "Verification required before completion:"),
            "out of order",
        ),
        "false-correction": (
            VALID.replace("Tasks:", "Current correction:\n- Wrong.\n\nTasks:"),
            "Current correction count",
        ),
        "no-command": (
            VALID.replace("`uv run --no-project python -m unittest -v`", "run checks"),
            "no exact backticked command",
        ),
        "vague": (VALID.replace("The named unittest command passes.", "It works well."), "vague"),
        "oversized": (VALID + "x" * 4000, "exceeds 4000"),
    }
    with tempfile.TemporaryDirectory(prefix="goal-validator-"):
        for name, (text, needle) in mutations.items():
            result = execute(script, text)
            if result.returncode == 0 or needle not in result.stdout:
                raise AssertionError(f"{name} escaped: {result.stdout}{result.stderr}")
    print(f"PASS: 2 positives and {len(mutations)} validator mutations")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
