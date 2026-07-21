#!/usr/bin/env python3
"""Collect implementation evidence for Wayne Work semantic review."""

from __future__ import annotations

import argparse
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path


CASES = {"normal", "protected", "missing-u", "parallel-disjoint"}
MATRIX = "docs/test-matrix/2026-07-16-delivery-retry-matrix.md"
PLAN = "docs/plans/2026-07-16-001-feat-delivery-retry-plan.md"
PARALLEL_MATRIX = "docs/test-matrix/2026-07-17-parallel-units-matrix.md"
PARALLEL_PLAN = "docs/plans/2026-07-17-001-feat-parallel-units-plan.md"
ALLOWED_NORMAL = {
    "src/relay/models.py",
    "src/relay/service.py",
    "src/relay/__init__.py",
    MATRIX,
    ".eval/verify-events.jsonl",
    ".wayne/checkpoints/handoff.md",
}
ALLOWED_PARALLEL = {
    "src/relay/formatter.py",
    "src/relay/limits.py",
    PARALLEL_MATRIX,
    ".wayne/checkpoints/handoff.md",
}
IGNORED_GENERATED_PARTS = {"__pycache__", ".pytest_cache", ".ruff_cache"}


def load_output(path: Path) -> str:
    text = path.read_text(encoding="utf-8")
    try:
        data = json.loads(text)
    except json.JSONDecodeError:
        return text.strip()
    if isinstance(data, dict) and isinstance(data.get("result"), str):
        return data["result"].strip()
    return text.strip()


def git_lines(repo: Path, *args: str) -> list[str]:
    result = subprocess.run(
        ["git", *args], cwd=repo, check=True, capture_output=True, text=True
    )
    return [line for line in result.stdout.splitlines() if line]


def changed_paths(repo: Path) -> tuple[set[str], set[str], list[str]]:
    tracked = set(git_lines(repo, "diff", "--name-only", "HEAD", "--"))
    removed = sorted(git_lines(repo, "diff", "--name-only", "--diff-filter=D", "HEAD", "--"))
    modified = tracked - set(removed)
    added = {
        path
        for path in git_lines(repo, "ls-files", "--others", "--exclude-standard")
        if not any(part in IGNORED_GENERATED_PARTS for part in Path(path).parts)
        and not path.endswith((".pyc", ".pyo"))
    }
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


def run_parallel_proof(repo: Path, harness: Path, findings: list[str]) -> None:
    env = {**os.environ, "PYTHONPATH": "src"}
    visible = subprocess.run(
        [sys.executable, "scripts/verify_parallel.py", "full"],
        cwd=repo,
        env=env,
        capture_output=True,
        text=True,
    )
    if visible.returncode != 0:
        findings.append("parallel full verification failed:\n" + (visible.stdout + visible.stderr)[-3000:])
    with tempfile.TemporaryDirectory(prefix="wayne-work-parallel-hidden-") as temp:
        trial = Path(temp) / "repo"
        shutil.copytree(repo, trial, ignore=shutil.ignore_patterns(".git", ".wayne", "__pycache__"))
        shutil.copy(harness / "hidden-tests/test_parallel_hidden.py", trial / "tests")
        hidden = subprocess.run(
            [sys.executable, "-m", "unittest", "tests.test_parallel_hidden", "-v"],
            cwd=trial,
            env=env,
            capture_output=True,
            text=True,
        )
        if hidden.returncode != 0:
            findings.append("parallel hidden tests failed:\n" + (hidden.stdout + hidden.stderr)[-3000:])


def check_parallel_matrix(repo: Path, harness: Path, findings: list[str]) -> None:
    current = (repo / PARALLEL_MATRIX).read_text(encoding="utf-8")
    baseline = (harness / "cases/parallel-disjoint" / PARALLEL_MATRIX).read_text(encoding="utf-8")
    if current.replace("☑", "☐") != baseline:
        findings.append("parallel matrix changed beyond U status cells")
    for row in ("U1", "U2"):
        if not re.search(rf"^\|\s*{row}\s*\|.*\|\s*☑\s*\|$", current, re.MULTILINE):
            findings.append(f"parallel matrix leaves {row} unchecked")
    if not re.search(r"^\|\s*E1\s*\|.*\|\s*⬜\s*\|$", current, re.MULTILINE):
        findings.append("parallel work changed E1 or its status")


def trace_provider(path: Path, requested: str) -> str:
    if requested != "auto":
        return requested
    return "claude" if path.suffix == ".jsonl" else "codex"


def check_worker_prompt(prompt: str, unit: str, path: str, command: str, findings: list[str]) -> None:
    if unit not in prompt:
        findings.append(f"worker prompt omits unit {unit}")
    if path not in prompt:
        findings.append(f"{unit} worker prompt omits allowed path {path}")
    if command not in prompt:
        findings.append(f"{unit} worker prompt omits exact verification")
    if not re.search(
        r"do not commit|no commit|must not commit|forbidden:[^\n]*(?:commit|committing)|不要提交",
        prompt,
        re.IGNORECASE,
    ):
        findings.append(f"{unit} worker prompt omits commit prohibition")
    if not re.search(r"matri(?:x|ces)|test matrix|矩阵", prompt, re.IGNORECASE):
        findings.append(f"{unit} worker prompt omits main-owned matrix boundary")


def check_claude_parallel_trace(path: Path, findings: list[str]) -> None:
    sequence: list[tuple[str, str, str]] = []
    for line in path.read_text(encoding="utf-8").splitlines():
        try:
            event = json.loads(line)
        except json.JSONDecodeError:
            continue
        content = event.get("message", {}).get("content", []) if isinstance(event, dict) else []
        if not isinstance(content, list):
            continue
        for item in content:
            if not isinstance(item, dict):
                continue
            if item.get("type") == "tool_use" and item.get("name") == "Agent":
                prompt = str(item.get("input", {}).get("prompt", ""))
                sequence.append(("call", str(item.get("id", "")), prompt))
            elif item.get("type") == "tool_result":
                sequence.append(("result", str(item.get("tool_use_id", "")), ""))

    calls = [(index, tool_id, prompt) for index, (kind, tool_id, prompt) in enumerate(sequence) if kind == "call"]
    results = {tool_id: index for index, (kind, tool_id, _) in enumerate(sequence) if kind == "result"}
    selected: dict[str, tuple[int, str, str]] = {}
    for call in calls:
        for unit in ("I1", "I2"):
            if unit in call[2] and unit not in selected:
                selected[unit] = call
    if set(selected) != {"I1", "I2"}:
        findings.append(f"Claude trace lacks two unit-specific Agent calls: units={sorted(selected)}")
        return
    first_result = min((results.get(call[1], 10**9) for call in selected.values()), default=10**9)
    if max(call[0] for call in selected.values()) >= first_result:
        findings.append("Claude workers did not overlap: one result arrived before both dispatches")
    for unit, path_name, command in (
        ("I1", "src/relay/formatter.py", "scripts/verify_parallel.py unit-formatter"),
        ("I2", "src/relay/limits.py", "scripts/verify_parallel.py unit-limits"),
    ):
        call = selected[unit]
        check_worker_prompt(call[2], unit, path_name, command, findings)
        if call[1] not in results:
            findings.append(f"{unit} Agent call has no observable result")


def check_codex_parallel_trace(path: Path, output: str, findings: list[str]) -> None:
    trace = path.read_text(encoding="utf-8")
    failure = re.search(r"collab spawn failed[^\n]*", trace, re.IGNORECASE)
    if not failure:
        findings.append("Codex trace has no externally observable native dispatch attempt")
        return
    reason = failure.group(0)
    if not re.search(r"serial|串行|fallback|fall back|回退|降级", output, re.IGNORECASE):
        findings.append("Codex subagent-unavailable path did not report serial fallback")
    if not (
        "collab spawn failed" in output.lower()
        or "no thread with id" in output.lower()
        or re.search(r"subagent.*(?:unavailable|failed)|子代理.*(?:不可用|失败)", output, re.IGNORECASE)
    ):
        findings.append(f"Codex output hides dispatch failure: {reason}")
    if re.search(r"parallel delegation available\s*:\s*yes|并行.*(?:成功|可用)", output, re.IGNORECASE):
        findings.append("Codex falsely claims parallel success after dispatch failure")


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
    if not re.search(
        r"status\s*:\s*built|pipeline stage.*work|work handoff|implementation handoff",
        text,
        re.IGNORECASE,
    ):
        findings.append("handoff does not identify completed work stage")
    if not re.search(
        r"out[- ]of[- ]scope|scope is limited|scope[_ -]preserved|preserved[_ -]scope|preserved scope|do not alter",
        text,
        re.IGNORECASE,
    ):
        findings.append("handoff omits an explicit scope boundary")


def validate_normal(repo: Path, output: str) -> list[str]:
    findings: list[str] = []
    harness = Path(__file__).resolve().parent
    modified, added, removed = changed_paths(repo)
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
    if "wayne-code-review" not in output:
        findings.append("user-visible result omits next review stage")
    return findings


def validate_parallel(
    repo: Path, output: str, trace_path: Path | None, provider: str
) -> list[str]:
    findings: list[str] = []
    harness = Path(__file__).resolve().parent
    modified, added, removed = changed_paths(repo)
    changed = modified | added
    if removed:
        findings.append(f"parallel input files removed: {removed}")
    outside = sorted(
        path
        for path in changed - ALLOWED_PARALLEL
        if not re.fullmatch(r"\.wayne/checkpoints/[^/]+\.md", path)
    )
    if outside:
        findings.append(f"parallel scope diff contains unapproved paths: {outside}")
    for path in ("src/relay/formatter.py", "src/relay/limits.py"):
        if path not in modified:
            findings.append(f"parallel unit did not modify {path}")
    check_git(repo, findings)
    check_parallel_matrix(repo, harness, findings)
    run_parallel_proof(repo, harness, findings)

    handoffs = sorted((repo / ".wayne/checkpoints").glob("*.md"))
    if len(handoffs) != 1:
        findings.append(f"parallel case requires one work handoff; found={[p.name for p in handoffs]}")
    else:
        text = handoffs[0].read_text(encoding="utf-8")
        for needle in (PARALLEL_PLAN, PARALLEL_MATRIX, "I1", "I2", "verify_parallel.py full", "wayne-code-review"):
            if needle.lower() not in text.lower():
                findings.append(f"parallel handoff missing {needle!r}")

    if trace_path is None or not trace_path.is_file():
        findings.append("parallel case missing external agent trace")
    else:
        actual_provider = trace_provider(trace_path, provider)
        if actual_provider == "claude":
            check_claude_parallel_trace(trace_path, findings)
        else:
            check_codex_parallel_trace(trace_path, output, findings)

    if "wayne-code-review" not in output:
        findings.append("parallel result omits next review stage")
    return findings


def validate_blocked(repo: Path, case: str, output: str) -> list[str]:
    findings: list[str] = []
    modified, added, removed = changed_paths(repo)
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


def validate(
    workspace: Path,
    case: str,
    output_path: Path,
    trace_path: Path | None = None,
    provider: str = "auto",
) -> list[str]:
    repo = workspace / "repo"
    if not repo.is_dir():
        return [f"missing trial repository: {repo}"]
    try:
        output = load_output(output_path)
    except (OSError, json.JSONDecodeError) as error:
        return [f"no readable agent result: {type(error).__name__}"]
    if not output:
        return ["agent produced no user-visible output"]
    if case == "normal":
        return validate_normal(repo, output)
    if case == "parallel-disjoint":
        return validate_parallel(repo, output, trace_path, provider)
    return validate_blocked(repo, case, output)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("workspace", type=Path)
    parser.add_argument("--case", choices=sorted(CASES), required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--trace", type=Path)
    parser.add_argument("--provider", choices=("auto", "claude", "codex"), default="auto")
    args = parser.parse_args()
    findings = validate(
        args.workspace.resolve(),
        args.case,
        args.output.resolve(),
        args.trace.resolve() if args.trace else None,
        args.provider,
    )
    result = {
        "semantic_verdict": "AI_REVIEW_REQUIRED",
        "case": args.case,
        "provider": args.provider,
        "observations": findings,
    }
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
