#!/usr/bin/env python3
"""Prove the candidate adapter fails loud when both providers fail."""

from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
import tempfile
from pathlib import Path


def run(command: list[str], cwd: Path) -> subprocess.CompletedProcess[str]:
    return subprocess.run(command, cwd=cwd, check=True, capture_output=True, text=True)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("candidate", type=Path)
    args = parser.parse_args()
    runner = args.candidate.resolve() / "scripts/run_dual_review.py"
    if not runner.is_file():
        print(f"FAIL: missing adapter: {runner}")
        return 1

    with tempfile.TemporaryDirectory(prefix="wayne-review-failure-") as temp:
        root = Path(temp)
        repo = root / "repo"
        evidence = root / "evidence"
        repo.mkdir()
        (repo / "app.py").write_text("VALUE = 1\n", encoding="utf-8")
        run(["git", "init", "-q"], repo)
        run(["git", "config", "user.name", "Eval Fixture"], repo)
        run(["git", "config", "user.email", "eval@example.invalid"], repo)
        run(["git", "add", "app.py"], repo)
        run(["git", "commit", "-q", "-m", "fixture: base"], repo)
        (repo / "app.py").write_text("VALUE = 2\n", encoding="utf-8")
        before = run(["git", "status", "--porcelain=v1"], repo).stdout

        env = os.environ.copy()
        env["WAYNE_REVIEW_OUTPUT_DIR"] = str(evidence)
        result = subprocess.run(
            [
                sys.executable,
                str(runner),
                "--review-type",
                "security",
                "--base",
                "HEAD",
                "--repo",
                str(repo),
                "--claude-bin",
                "/bin/false",
                "--codex-bin",
                "/bin/false",
                "--timeout-seconds",
                "5",
            ],
            check=False,
            capture_output=True,
            text=True,
            env=env,
        )
        findings: list[str] = []
        if result.returncode == 0:
            findings.append("provider failure returned success")
        if not (evidence / "manifest.json").is_file():
            findings.append("WAYNE_REVIEW_OUTPUT_DIR did not own failure evidence")
        else:
            manifest = json.loads((evidence / "manifest.json").read_text(encoding="utf-8"))
            if manifest.get("status") != "REVIEW_UNAVAILABLE":
                findings.append("provider failure was not REVIEW_UNAVAILABLE")
            if manifest.get("repo_manifest_before_sha256") != manifest.get(
                "repo_manifest_after_sha256"
            ):
                findings.append("provider failure changed repository manifest")
            providers = manifest.get("providers", {})
            if set(providers) != {"claude", "codex"}:
                findings.append("failure manifest lost a provider record")
            for provider in ("claude", "codex"):
                record = providers.get(provider, {})
                if record.get("status") != "INVALID" or record.get("exit_code") == 0:
                    findings.append(f"{provider} failure was not retained")
                review = json.loads(
                    (evidence / f"{provider}-review.json").read_text(encoding="utf-8")
                )
                if review:
                    findings.append(f"{provider} failure was converted into a review")
        if "REVIEW_UNAVAILABLE" not in result.stderr:
            findings.append("failure reason is absent from stderr")
        if run(["git", "status", "--porcelain=v1"], repo).stdout != before:
            findings.append("adapter failure mutated the product repository")

        if findings:
            for finding in findings:
                print(f"FAIL: {finding}")
            return 1
    print("PASS: adapter provider failure is REVIEW_UNAVAILABLE and read-only")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
