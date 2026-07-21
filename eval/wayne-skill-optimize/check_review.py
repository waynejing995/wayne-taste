#!/usr/bin/env python3
"""Validate one external semantic review and its read-only source workspace."""

from __future__ import annotations

import argparse
from pathlib import Path

from dossier_checker import (
    load_object,
    validate_ledger,
    validate_review_file,
)


def manifest(repo: Path) -> list[str]:
    """Hash only the evaluator-owned dossier, never the whole repository."""
    import hashlib

    root = repo / "eval/decision-builder"
    rows = []
    for path in sorted(
        item
        for item in root.rglob("*")
        if item.is_file() and ".git" not in item.relative_to(root).parts
    ):
        digest = hashlib.sha256(path.read_bytes()).hexdigest()
        rows.append(f"{digest}  {path.as_posix()}")
    return rows


def git(repo: Path, *args: str) -> str:
    import subprocess

    return subprocess.run(
        ["git", *args],
        cwd=repo,
        check=True,
        capture_output=True,
        text=True,
    ).stdout


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("workspace", type=Path)
    parser.add_argument("--provider", choices=("claude", "codex"), required=True)
    args = parser.parse_args()
    workspace = args.workspace.resolve()
    repo = workspace / "repo"
    dossier = repo / "eval/decision-builder"
    findings: list[str] = []

    expected_manifest = (workspace / "dossier-manifest.sha256").read_text().splitlines()
    if manifest(repo) != expected_manifest:
        findings.append("reviewer modified the frozen intent dossier")
    if git(repo, "rev-parse", "HEAD").strip() != (
        workspace / "repo-head.txt"
    ).read_text(encoding="utf-8").strip():
        findings.append("reviewer changed repository HEAD")
    if git(repo, "status", "--porcelain=v1", "--untracked-files=all") != (
        workspace / "repo-status.txt"
    ).read_text(encoding="utf-8"):
        findings.append("reviewer changed Git tracked/untracked path state")
    import hashlib

    current_diff = hashlib.sha256(
        git(repo, "diff", "--binary", "--full-index", "HEAD", "--").encode()
    ).hexdigest()
    if current_diff != (workspace / "repo-diff.sha256").read_text().strip():
        findings.append("reviewer changed the frozen tracked diff")

    ledger, behavior_ids, oracle_ids, combined_hash = validate_ledger(
        repo, dossier, findings
    )
    source_hash, ledger_hash = combined_hash.split(":", 1)
    sources = ledger.get("sources")
    source_ids = {
        item["id"]
        for item in sources
        if isinstance(item, dict) and isinstance(item.get("id"), str)
    } if isinstance(sources, list) else set()
    validate_review_file(
        workspace / "review.json",
        args.provider,
        source_hash,
        ledger_hash,
        source_ids,
        behavior_ids,
        oracle_ids,
        findings,
    )
    context = load_object(workspace / "review-context.json", findings)
    report = load_object(workspace / "review.json", findings)
    for field in (
        "version",
        "provider",
        "source_sha256",
        "ledger_sha256",
    ):
        if report.get(field) != context.get(field):
            findings.append(f"review changed frozen context field: {field}")

    if findings:
        for finding in findings:
            print(f"FAIL: {finding}")
        return 1
    print(f"PASS: independent {args.provider} source-fidelity review")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
