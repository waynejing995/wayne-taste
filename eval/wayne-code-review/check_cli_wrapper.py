#!/usr/bin/env python3
"""Check the dual-review CLI transport defaults without launching providers."""

from __future__ import annotations

import argparse
import importlib.util
import sys
import tempfile
from pathlib import Path


def load_runner(skill: Path):
    path = skill / "scripts/run_dual_review.py"
    spec = importlib.util.spec_from_file_location("wayne_dual_review", path)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"cannot import runner: {path}")
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("skill", type=Path)
    args = parser.parse_args()
    runner = load_runner(args.skill.resolve())
    findings: list[str] = []

    if runner.DEFAULT_TIMEOUT_SECONDS != 1800.0:
        findings.append("default provider timeout is not 1800 seconds")

    with tempfile.TemporaryDirectory(prefix="wayne-review-cli-") as temp:
        root = Path(temp)
        repo = root / "repo"
        output = root / "evidence"
        repo.mkdir()
        output.mkdir()
        command_args = argparse.Namespace(
            claude_bin="claude",
            claude_model=None,
            claude_effort=None,
            codex_bin="codex",
            codex_model=None,
            codex_effort=None,
        )
        specs = runner.command_specs(
            command_args,
            root / "schema.json",
            {},
            output,
            repo,
        )
        codex_command = specs["codex"].command
        if "--sandbox" in codex_command:
            findings.append("Codex command still imposes a filesystem sandbox")

    if findings:
        for finding in findings:
            print(f"FAIL: {finding}")
        return 1
    print("PASS: no Codex sandbox override; default timeout is 1800 seconds")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
