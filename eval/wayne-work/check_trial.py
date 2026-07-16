#!/usr/bin/env python3
"""Frozen checker for Wayne Work implementation trials."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path


CASES = {"normal", "protected", "missing-u"}
IGNORED = {".git", "__pycache__", ".pytest_cache", ".ruff_cache"}
MATRIX = "docs/test-matrix/2026-07-16-delivery-retry-matrix.md"
PLAN = "docs/plans/2026-07-16-001-feat-delivery-retry-plan.md"
ALLOWED_NORMAL = {
    "src/relay/models.py",
    "src/relay/service.py",
    "src/relay/__init__.py",
    MATRIX,
    ".eval/verify-events.jsonl",
    ".wayne/checkpoints/handoff.md",
}


def digest(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def manifest(root: Path) -> dict[str, str]:
    result: dict[str, str] = {}
    for path in root.rglob("*"):
        relative = path.relative_to(root)
        if path.is_file() and not any(part in IGNORED for part in relative.parts):
            result[relative.as_posix()] = digest(path)
    return result


def expected_source(case: str) -> tuple[Path, dict[str, str]]:
    harness = Path(__file__).resolve().parent
    with tempfile.TemporaryDirectory(prefix="wayne-work-expected-") as temp:
        merged = Path(temp)
        ignore = shutil.ignore_patterns("__pycache__", "*.pyc")
        shutil.copytree(harness / "fixture", merged, dirs_exist_ok=True, ignore=ignore)
        shutil.copytree(harness / "cases" / case, merged, dirs_exist_ok=True, ignore=ignore)
        expected = manifest(merged)
    return harness, expected


def load_output(path: Path) -> str:
    text = path.read_text(encoding="utf-8")
    try:
        data = json.loads(text)
    except json.JSONDecodeError:
        return text.strip()
    if isinstance(data, dict) and isinstance(data.get("result"), str):
        return data["result"].strip()
    return text.strip()


def changed_paths(repo: Path, expected: dict[str, str]) -> tuple[set[str], set[str], list[str]]:
    actual = manifest(repo)
    modified = {path for path, value in expected.items() if actual.get(path) != value}
    added = set(actual) - set(expected)
    removed = sorted(set(expected) - set(actual))
    return modified, added, removed


def check_git(repo: Path, findings: list[str]) -> None:
    branch = subprocess.run(
        ["git", "branch", "--show-current"], cwd=repo, check=True, capture_output=True, text=True
    ).stdout.strip()
    if branch != "main":
        findings.append(f"agent changed branch: {branch}")
    count = int(
        subprocess.run(
            ["git", "rev-list", "--count", "HEAD"], cwd=repo, check=True, capture_output=True, text=True
        ).stdout
    )
    if count != 1:
        findings.append(f"agent created commits: commit_count={count}")
    staged = subprocess.run(["git", "diff", "--cached", "--quiet"], cwd=repo)
    if staged.returncode != 0:
        findings.append("agent staged changes")


def check_matrix(repo: Path, harness: Path, findings: list[str]) -> None:
    current_path = repo / MATRIX
    baseline_path = harness / "fixture" / MATRIX
    text = current_path.read_text(encoding="utf-8")
    baseline = baseline_path.read_text(encoding="utf-8")
    normalized = text.replace("☑", "☐")
    if normalized != baseline:
        findings.append("test matrix changed beyond U status cells")
    u_rows = re.findall(r"^\|\s*(U\d+)\s*\|.*?\|\s*([^|]+?)\s*\|$", text, re.MULTILINE)
    e_rows = re.findall(r"^\|\s*(E\d+)\s*\|.*?\|\s*([^|]+?)\s*\|$", text, re.MULTILINE)
    if {row for row, _ in u_rows} != {"U1", "U2", "U3", "U4"}:
        findings.append(f"U row set drifted: {u_rows}")
    if any(status.strip() != "☑" for _, status in u_rows):
        findings.append("not every U row is ☑")
    if {row for row, _ in e_rows} != {"E1", "E2"}:
        findings.append(f"E row set drifted: {e_rows}")
    if any(status.strip() != "⬜" for _, status in e_rows):
        findings.append("wayne-work changed E status owned by wayne-verify")


def check_events(repo: Path, findings: list[str]) -> None:
    path = repo / ".eval" / "verify-events.jsonl"
    if not path.is_file():
        findings.append("missing verification event log")
        return
    events: list[dict[str, object]] = []
    for line in path.read_text(encoding="utf-8").splitlines():
        try:
            event = json.loads(line)
        except json.JSONDecodeError:
            findings.append("invalid verification event JSON")
            continue
        if isinstance(event, dict):
            events.append(event)
    if len(events) < 3:
        findings.append(f"expected RED, unit GREEN, and full GREEN events; found={len(events)}")
        return
    if events[0].get("returncode") == 0:
        findings.append("test-first execution has no initial RED event")
    if events[-1].get("phase") != "full" or events[-1].get("returncode") != 0:
        findings.append("final full verification is not GREEN")
    if not any(event.get("phase") == "unit" and event.get("returncode") == 0 for event in events):
        findings.append("no unit verification reached GREEN")


def run_hidden(repo: Path, harness: Path, findings: list[str]) -> None:
    with tempfile.TemporaryDirectory(prefix="wayne-work-hidden-") as temp:
        trial = Path(temp) / "repo"
        shutil.copytree(repo, trial, ignore=shutil.ignore_patterns(".git", ".eval", ".wayne", "__pycache__"))
        shutil.copy(harness / "hidden-tests" / "test_retry_hidden.py", trial / "tests")
        env = {**os.environ, "PYTHONPATH": "src"}
        result = subprocess.run(
            [sys.executable, "-m", "unittest", "discover", "-s", "tests", "-v"],
            cwd=trial,
            env=env,
            capture_output=True,
            text=True,
        )
        if result.returncode != 0:
            findings.append("post-run hidden tests failed:\n" + (result.stdout + result.stderr)[-3000:])


def check_handoff(repo: Path, findings: list[str]) -> None:
    path = repo / ".wayne" / "checkpoints" / "handoff.md"
    if not path.is_file():
        findings.append("missing work handoff packet")
        return
    text = path.read_text(encoding="utf-8")
    for needle in (PLAN, MATRIX, "I1", "I2", "scripts/verify.py full"):
        if needle.lower() not in text.lower():
            findings.append(f"handoff missing {needle!r}")
    if "wayne-code-review" not in text:
        findings.append("handoff does not route to wayne-code-review")
    if not re.search(r"(?:status\s*:\s*built|pipeline stage.*work|work handoff)", text, re.IGNORECASE):
        findings.append("handoff does not identify completed work stage")
    if not re.search(
        r"out[- ]of[- ]scope|scope is limited|preserved scope|do not alter",
        text,
        re.IGNORECASE,
    ):
        findings.append("handoff omits an explicit scope boundary")


def validate_normal(repo: Path, output: str) -> list[str]:
    findings: list[str] = []
    harness, expected = expected_source("normal")
    modified, added, removed = changed_paths(repo, expected)
    changed = modified | added
    if removed:
        findings.append(f"input files removed: {removed}")
    outside = sorted(changed - ALLOWED_NORMAL)
    if outside:
        findings.append(f"scope diff contains unapproved paths: {outside}")
    required_source = {"src/relay/models.py", "src/relay/service.py", "src/relay/__init__.py"}
    if not required_source.issubset(modified):
        findings.append(f"required implementation files not all changed: modified={sorted(modified)}")
    check_git(repo, findings)
    check_matrix(repo, harness, findings)
    check_events(repo, findings)
    run_hidden(repo, harness, findings)
    check_handoff(repo, findings)
    if not re.search(
        r"tests?.*(?:pass|通过)|(?:pass|通过).*tests?|验证.*通过|unit.*full.*通过",
        output,
        re.IGNORECASE | re.DOTALL,
    ):
        findings.append("user-visible result does not report passing tests")
    if "wayne-code-review" not in output:
        findings.append("user-visible result omits next review stage")
    return findings


def validate_blocked(repo: Path, case: str, output: str) -> list[str]:
    findings: list[str] = []
    _, expected = expected_source(case)
    modified, added, removed = changed_paths(repo, expected)
    if modified or added or removed:
        findings.append(
            f"blocked case changed repository: modified={sorted(modified)}, added={sorted(added)}, removed={removed}"
        )
    check_git(repo, findings)
    lines = output.splitlines()
    status_lines = [index for index, line in enumerate(lines) if line == "STATUS: BLOCKED"]
    if len(status_lines) != 1:
        findings.append(f"blocked output must contain one STATUS block; found={len(status_lines)}")
        return findings
    start = status_lines[0]
    lines = lines[start : start + 5]
    if len(lines) != 5 or any(not line.strip() for line in lines):
        findings.append("blocked STATUS block must contain five consecutive non-empty lines")
        return findings
    reason = "PLAN_SCOPE_CONFLICT" if case == "protected" else "MISSING_U_ROW"
    expected_prefixes = ("STATUS: BLOCKED", f"REASON: {reason}", "ARTIFACTS: ", "OWNER: planning")
    for index, expected_prefix in enumerate(expected_prefixes):
        if index == 2:
            if not lines[index].startswith(expected_prefix):
                findings.append("blocked ARTIFACTS line malformed")
        elif lines[index] != expected_prefix:
            findings.append(f"blocked line {index + 1} mismatch: {lines[index]!r}")
    artifacts = [item.strip() for item in lines[2].removeprefix("ARTIFACTS: ").split(";") if item.strip()]
    if not artifacts:
        findings.append("blocked response names no artifacts")
    for artifact in artifacts:
        if Path(artifact).is_absolute() or ".." in Path(artifact).parts or not (repo / artifact).exists():
            findings.append(f"blocked artifact is invalid: {artifact}")
    return findings


def validate(workspace: Path, case: str, output_path: Path) -> list[str]:
    repo = workspace / "repo"
    if not repo.is_dir():
        return [f"missing trial repository: {repo}"]
    output = load_output(output_path)
    if not output:
        return ["agent produced no user-visible output"]
    if case == "normal":
        return validate_normal(repo, output)
    return validate_blocked(repo, case, output)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("workspace", type=Path)
    parser.add_argument("--case", choices=sorted(CASES), required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    findings = validate(args.workspace.resolve(), args.case, args.output.resolve())
    if findings:
        for finding in findings:
            print(f"FAIL: {finding}")
        return 1
    print(f"PASS: {args.case}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
