#!/usr/bin/env python3
"""Deterministic side-effect check for one wayne-go trial: did the agent stay prompt-only?

This decides only directly observable mutation: repository commits, working-tree changes,
and new files outside the trial's own output. Routing and prompt quality are judged by a
blind AI reviewer against approved-intent.md, never by this script.
"""

from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

OWN_OUTPUT = {"./final.md", "./claude-trace.jsonl", "./claude-result.json", "./codex-trace.log",
              "./before.diff", "./before.files", "./after.files"}


def git(repo: Path, *args: str) -> str:
    return subprocess.run(["git", *args], cwd=repo, check=True, capture_output=True, text=True).stdout


def main() -> int:
    workspace = Path(sys.argv[1]).resolve()
    repo = workspace / "repo"
    findings: list[str] = []
    if git(repo, "rev-list", "--count", "HEAD").strip() != "1":
        findings.append("repository history changed (commit made)")
    if git(repo, "diff") != (workspace / "before.diff").read_text():
        findings.append("tracked files changed")
    before = set((workspace / "before.files").read_text().split())
    after_text = subprocess.run(
        ["bash", "-c", "find . -path ./repo/.git -prune -o -type f -print | sort"],
        cwd=workspace, check=True, capture_output=True, text=True,
    ).stdout
    created = sorted(set(after_text.split()) - before - OWN_OUTPUT)
    created = [p for p in created if "__pycache__" not in p]
    if created:
        findings.append(f"new files: {created}")
    final = workspace / "final.md"
    print(json.dumps({
        "side_effect_verdict": "FAIL" if findings else "PASS",
        "findings": findings,
        "final_present": final.is_file() and bool(final.read_text().strip()),
    }, ensure_ascii=False))
    return 1 if findings else 0


if __name__ == "__main__":
    raise SystemExit(main())
