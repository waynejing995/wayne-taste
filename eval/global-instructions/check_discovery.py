#!/usr/bin/env python3
"""Check that one host loaded the mounted global instruction surface."""

from __future__ import annotations

import argparse
import hashlib
import json
import subprocess
from pathlib import Path


def digest(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("workspace", type=Path)
    parser.add_argument("--agent", required=True, choices=("claude", "codex"))
    args = parser.parse_args()
    workspace = args.workspace.resolve()
    findings: list[str] = []
    if args.agent == "claude":
        try:
            data = json.loads((workspace / "claude-result.json").read_text(encoding="utf-8"))
            output = str(data.get("result", "")).strip()
        except (OSError, json.JSONDecodeError):
            output = ""
    else:
        path = workspace / "codex-final.txt"
        output = path.read_text(encoding="utf-8").strip() if path.is_file() else ""
    if output != "GLOBAL_INSTRUCTION_SENTINEL":
        findings.append(f"global marker differs: {output!r}")
    expected = (workspace / "instructions.sha256").read_text(encoding="utf-8").strip()
    if digest(workspace / "instructions.md") != expected:
        findings.append("mounted instruction bytes changed")
    status = subprocess.run(
        ["git", "status", "--porcelain=v1"],
        cwd=workspace / "repo",
        check=True,
        capture_output=True,
        text=True,
    ).stdout
    if status:
        findings.append(f"discovery probe mutated repository: {status!r}")
    if findings:
        for finding in findings:
            print(f"FAIL: {finding}")
        return 1
    print(f"PASS: global discovery / {args.agent}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
