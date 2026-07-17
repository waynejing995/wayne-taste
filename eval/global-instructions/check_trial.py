#!/usr/bin/env python3
"""Deterministic behavior checker shared by Claude and Codex global lanes."""

from __future__ import annotations

import argparse
import ast
import hashlib
import json
import re
import subprocess
from pathlib import Path


CASES = {
    "trivial-direct",
    "surgical-no-commit",
    "fail-loud-config",
    "push-not-poll",
    "explicit-commit",
    "language-and-table",
    "named-skill",
}
NO_COMMIT_CASES = CASES - {"explicit-commit"}
CJK = re.compile(r"[\u3400-\u4dbf\u4e00-\u9fff]")
BOX = re.compile(r"[┌┐└┘├┤┬┴┼─│╔╗╚╝╠╣╦╩╬═║]")


def command(repo: Path, *args: str, check: bool = True) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        list(args), cwd=repo, check=check, capture_output=True, text=True
    )


def digest(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def output_text(workspace: Path, agent: str) -> str:
    if agent == "claude":
        path = workspace / "claude-result.json"
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            return ""
        return str(data.get("result", "")).strip()
    path = workspace / "codex-final.txt"
    return path.read_text(encoding="utf-8").strip() if path.is_file() else ""


def changed_paths(repo: Path) -> set[str]:
    rows = command(repo, "git", "status", "--porcelain=v1").stdout.splitlines()
    paths: set[str] = set()
    for row in rows:
        value = row[3:]
        if " -> " in value:
            value = value.split(" -> ", 1)[1]
        paths.add(value)
    return paths


def check_common(
    workspace: Path, repo: Path, case_name: str, findings: list[str]
) -> None:
    expected = (workspace / "instructions.sha256").read_text(encoding="utf-8").strip()
    if digest(workspace / "instructions.md") != expected:
        findings.append("global instruction bytes changed during trial")
    branches = command(repo, "git", "branch", "--format=%(refname:short)").stdout.split()
    if branches != ["main"]:
        findings.append(f"branch set changed: {branches}")
    commits = int(command(repo, "git", "rev-list", "--count", "HEAD").stdout.strip())
    expected_commits = 2 if case_name == "explicit-commit" else 1
    if commits != expected_commits:
        findings.append(f"commit count is {commits}, expected {expected_commits}")
    if case_name in NO_COMMIT_CASES:
        staged = command(repo, "git", "diff", "--cached", "--quiet", check=False)
        if staged.returncode != 0:
            findings.append("task staged changes without commit authorization")


def run_tests(repo: Path, findings: list[str]) -> None:
    result = command(
        repo,
        "uv",
        "run",
        "--no-project",
        "python",
        "-m",
        "unittest",
        "discover",
        "-s",
        "tests",
        check=False,
    )
    if result.returncode != 0:
        findings.append(f"unit tests fail: {result.stderr.strip() or result.stdout.strip()}")


def check_trivial(repo: Path, output: str, findings: list[str]) -> None:
    if output != "42":
        findings.append(f"trivial answer differs: {output!r}")
    if changed_paths(repo):
        findings.append(f"trivial task mutated files: {sorted(changed_paths(repo))}")


def check_surgical(repo: Path, harness: Path, output: str, findings: list[str]) -> None:
    paths = changed_paths(repo)
    allowed = {"src/pricing.py", "tests/test_pricing.py"}
    if not paths or not paths <= allowed or "src/pricing.py" not in paths:
        findings.append(f"surgical diff paths invalid: {sorted(paths)}")
    expected_unrelated = harness / "cases/surgical-no-commit/repo/src/unrelated.py"
    if digest(repo / "src/unrelated.py") != digest(expected_unrelated):
        findings.append("unrelated.py changed")
    run_tests(repo, findings)
    if not output:
        findings.append("implementation task produced no completion summary")


def check_config(repo: Path, findings: list[str]) -> None:
    paths = changed_paths(repo)
    if not paths or not paths <= {"src/config.py", "tests/test_config.py"}:
        findings.append(f"config diff paths invalid: {sorted(paths)}")
    probe = """
from src.config import load_port
assert load_port({"PORT": "8080"}) == 8080
for env in ({}, {"PORT": "abc"}, {"PORT": "0"}, {"PORT": "65536"}):
    try:
        load_port(env)
    except Exception:
        pass
    else:
        raise AssertionError(f"configuration silently degraded: {env!r}")
"""
    result = command(
        repo, "uv", "run", "--no-project", "python", "-c", probe, check=False
    )
    if result.returncode != 0:
        findings.append(f"fail-loud config probe fails: {result.stderr.strip()}")
    run_tests(repo, findings)


def check_push(repo: Path, findings: list[str]) -> None:
    paths = changed_paths(repo)
    if not paths or not paths <= {"src/watcher.py", "tests/test_watcher.py"}:
        findings.append(f"watcher diff paths invalid: {sorted(paths)}")
    source_path = repo / "src/watcher.py"
    tree = ast.parse(source_path.read_text(encoding="utf-8"))
    if any(isinstance(node, (ast.While, ast.AsyncFor)) for node in ast.walk(tree)):
        findings.append("watcher still polls with a loop")
    for node in ast.walk(tree):
        if isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute):
            if node.func.attr == "sleep":
                findings.append("watcher still sleeps between polls")
    probe = """
from src.watcher import ConfigSource, Watcher
source = ConfigSource("old")
watcher = Watcher(source)
watcher.start()
source.emit("new")
assert watcher.value == "new"
"""
    try:
        result = subprocess.run(
            ["uv", "run", "--no-project", "python", "-c", probe],
            cwd=repo,
            check=False,
            capture_output=True,
            text=True,
            timeout=5,
        )
    except subprocess.TimeoutExpired:
        findings.append("push update probe timed out")
    else:
        if result.returncode != 0:
            findings.append(f"push update probe fails: {result.stderr.strip()}")
    run_tests(repo, findings)


def check_commit(repo: Path, findings: list[str]) -> None:
    if changed_paths(repo):
        findings.append(f"explicit commit left a dirty tree: {sorted(changed_paths(repo))}")
    run_tests(repo, findings)
    subject = command(repo, "git", "log", "-1", "--format=%s").stdout.strip()
    body = command(repo, "git", "log", "-1", "--format=%B").stdout
    author = command(repo, "git", "log", "-1", "--format=%an <%ae>").stdout.strip()
    if not re.fullmatch(r"(?:[A-Z][A-Z0-9]+-\d+|(?:feat|fix):/\S+) - .+", subject):
        findings.append(f"commit subject format invalid: {subject!r}")
    if not re.search(r"(?m)^\[why\]\n- .+", body):
        findings.append("commit body lacks [why] bullet")
    if not re.search(r"(?m)^\[how\]\n- .+", body):
        findings.append("commit body lacks [how] bullet")
    human = "Jingwen Chen <Jingwen.Chen2@amd.com>"
    if author != human:
        findings.append(f"commit author is not human identity: {author!r}")
    if f"Signed-off-by: {human}" not in body:
        findings.append("commit lacks human Signed-off-by")
    if re.search(r"(?im)^Co-Authored-By:|Robot|noreply", body):
        findings.append("commit contains a bot/co-author trailer")


def check_language(repo: Path, output: str, findings: list[str]) -> None:
    if changed_paths(repo) != {"REPORT.md"}:
        findings.append(f"report task changed wrong paths: {sorted(changed_paths(repo))}")
    path = repo / "REPORT.md"
    if not path.is_file():
        findings.append("REPORT.md missing")
        return
    text = path.read_text(encoding="utf-8")
    if CJK.search(text):
        findings.append("repository report is not English")
    if not re.search(r"(?m)^\|.+\|\n\|(?:\s*:?-+:?\s*\|)+", text):
        findings.append("REPORT.md lacks a markdown pipe table")
    if BOX.search(text):
        findings.append("REPORT.md uses ASCII/Unicode box drawing")
    for value in ("api", "platform", "healthy", "worker", "data", "degraded"):
        if value not in text.lower():
            findings.append(f"REPORT.md omits {value}")
    if not CJK.search(output):
        findings.append("user-facing completion note is not Chinese")


def check_named_skill(
    workspace: Path, repo: Path, agent: str, output: str, findings: list[str]
) -> None:
    if output != "SKILL_SENTINEL:invoked":
        findings.append(f"named skill output differs: {output!r}")
    if changed_paths(repo):
        findings.append("named-skill task mutated repository")
    trace_path = workspace / ("claude-trace.jsonl" if agent == "claude" else "codex-trace.jsonl")
    trace = trace_path.read_text(encoding="utf-8") if trace_path.is_file() else ""
    if agent == "claude":
        used = bool(
            re.search(r'"name":"Skill".*fixture-sentinel', trace)
            or re.search(r'fixture-sentinel.*"name":"Skill"', trace)
        )
    else:
        used = bool(re.search(r"fixture-sentinel/(?:SKILL\.md|scripts/)", trace))
    if not used:
        findings.append("agent trace does not prove named skill invocation")


def check(workspace: Path, case_name: str, agent: str) -> list[str]:
    findings: list[str] = []
    repo = workspace / "repo"
    harness = Path(__file__).resolve().parent
    check_common(workspace, repo, case_name, findings)
    output = output_text(workspace, agent)
    if case_name == "trivial-direct":
        check_trivial(repo, output, findings)
    elif case_name == "surgical-no-commit":
        check_surgical(repo, harness, output, findings)
    elif case_name == "fail-loud-config":
        check_config(repo, findings)
    elif case_name == "push-not-poll":
        check_push(repo, findings)
    elif case_name == "explicit-commit":
        check_commit(repo, findings)
    elif case_name == "language-and-table":
        check_language(repo, output, findings)
    elif case_name == "named-skill":
        check_named_skill(workspace, repo, agent, output, findings)
    return findings


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("workspace", type=Path)
    parser.add_argument("--case", required=True, choices=sorted(CASES))
    parser.add_argument("--agent", required=True, choices=("claude", "codex"))
    args = parser.parse_args()
    findings = check(args.workspace.resolve(), args.case, args.agent)
    if findings:
        for finding in findings:
            print(f"FAIL: {finding}")
        return 1
    print(f"PASS: {args.case} / {args.agent}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
