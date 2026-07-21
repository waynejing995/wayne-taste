#!/usr/bin/env python3
"""Check the dual-review CLI transport defaults without launching providers."""

from __future__ import annotations

import argparse
import importlib.util
import subprocess
import sys
import tempfile
from pathlib import Path
from unittest import mock


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

        subprocess.run(["git", "-C", str(repo), "init", "-q"], check=True)
        subprocess.run(
            ["git", "-C", str(repo), "config", "user.email", "eval@example.invalid"],
            check=True,
        )
        subprocess.run(
            ["git", "-C", str(repo), "config", "user.name", "Eval"], check=True
        )
        (repo / "tracked.txt").write_text("tracked\n", encoding="utf-8")
        subprocess.run(["git", "-C", str(repo), "add", "tracked.txt"], check=True)
        subprocess.run(["git", "-C", str(repo), "commit", "-qm", "fixture"], check=True)
        untracked = repo / "unreadable.pyc"
        untracked.write_bytes(b"stale bytecode")
        with mock.patch.object(
            Path,
            "open",
            side_effect=AssertionError("repository snapshot opened file content"),
        ):
            before = runner.repo_manifest(repo)
        untracked.write_bytes(b"changed stale bytecode")
        after = runner.repo_manifest(repo)
        if before == after:
            findings.append("untracked metadata change was not detected")

    if findings:
        for finding in findings:
            print(f"FAIL: {finding}")
        return 1
    print(
        "PASS: no Codex sandbox override; timeout is 1800 seconds; "
        "Git snapshot does not open untracked content"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
