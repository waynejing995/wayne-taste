#!/usr/bin/env python3
"""Check that Claude and Codex ran the same frozen global-instruction input."""

from __future__ import annotations

import argparse
import json
from pathlib import Path


SAME = ("case", "candidate_sha256", "task_sha256", "base_tree", "harness_sha256")


def load(path: Path) -> dict[str, object]:
    value = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(value, dict):
        raise TypeError(path)
    return value


def check(claude: Path, codex: Path) -> list[str]:
    findings: list[str] = []
    ci, xi = load(claude / "input-manifest.json"), load(codex / "input-manifest.json")
    cr, xr = load(claude / "run-status.json"), load(codex / "run-status.json")
    for field in SAME:
        if ci.get(field) != xi.get(field):
            findings.append(f"paired input differs: {field}")
    if ci.get("workspace_id") == xi.get("workspace_id"):
        findings.append("paired lanes reused a workspace")
    if cr.get("state_id") == xr.get("state_id"):
        findings.append("paired lanes reused run state")
    if cr.get("agent") != "claude" or xr.get("agent") != "codex":
        findings.append("paired lanes have wrong agent identities")
    if cr.get("status") != "complete" or xr.get("status") != "complete":
        findings.append("paired lane is invalid or incomplete")
    if cr.get("effort") != xr.get("effort"):
        findings.append("paired effort differs")
    if not cr.get("model") or not xr.get("model"):
        findings.append("paired model identity is missing")
    return findings


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("claude_workspace", type=Path)
    parser.add_argument("codex_workspace", type=Path)
    args = parser.parse_args()
    findings = check(args.claude_workspace.resolve(), args.codex_workspace.resolve())
    if findings:
        for finding in findings:
            print(f"FAIL: {finding}")
        return 1
    print("PASS: shared Claude/Codex inputs and isolated states")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
