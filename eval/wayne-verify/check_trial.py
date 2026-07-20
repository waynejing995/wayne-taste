#!/usr/bin/env python3
"""Deterministic behavioral checker for Wayne Verify trials."""

from __future__ import annotations

import argparse
import json
import re
import subprocess
from pathlib import Path


CASES = {
    "cli-success",
    "server-success",
    "stale-green",
    "startup-failure",
    "missing-contract",
    "suspect-skip",
    "multi-row",
    "legit-skip",
}
ALLOWED_PREFIXES = (
    "docs/test-matrix/",
    "output/",
    "run/",
    "config/",
    "__pycache__/",
    ".wayne-verify/",
    "scratch/",
    ".wayne/",
)


def output_text(workspace: Path, agent: str) -> str:
    if agent == "claude":
        try:
            data = json.loads((workspace / "claude-result.json").read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            return ""
        return str(data.get("result", "")).strip()
    path = workspace / "codex-final.txt"
    return path.read_text(encoding="utf-8").strip() if path.is_file() else ""


def strings(value: object) -> list[str]:
    if isinstance(value, str):
        return [value]
    if isinstance(value, list):
        return [item for child in value for item in strings(child)]
    if isinstance(value, dict):
        return [item for child in value.values() for item in strings(child)]
    return []


def trace_text(workspace: Path) -> str:
    chunks: list[str] = []
    claude = workspace / "claude-trace.jsonl"
    if claude.is_file():
        for line in claude.read_text(encoding="utf-8", errors="ignore").splitlines():
            try:
                chunks.extend(strings(json.loads(line)))
            except json.JSONDecodeError:
                chunks.append(line)
    codex = workspace / "codex-trace.log"
    if codex.is_file():
        chunks.append(codex.read_text(encoding="utf-8", errors="ignore"))
    return "\n".join(chunks)


def command_text(workspace: Path) -> str:
    commands: list[str] = []
    claude = workspace / "claude-trace.jsonl"
    if claude.is_file():
        for line in claude.read_text(encoding="utf-8", errors="ignore").splitlines():
            try:
                data = json.loads(line)
            except json.JSONDecodeError:
                continue
            content = data.get("message", {}).get("content", [])
            if not isinstance(content, list):
                continue
            for block in content:
                if not isinstance(block, dict) or block.get("type") != "tool_use":
                    continue
                if block.get("name") not in {"Bash", "Shell", "exec_command"}:
                    continue
                tool_input = block.get("input", {})
                if isinstance(tool_input, dict):
                    command = tool_input.get("command") or tool_input.get("cmd")
                    if isinstance(command, str):
                        commands.append(command)
    codex = workspace / "codex-trace.log"
    if codex.is_file():
        raw = codex.read_text(encoding="utf-8", errors="ignore")
        commands.extend(re.findall(r"(?ms)^exec\n(.*?) in /workspace/repo\n", raw))
    return "\n".join(commands)


def git(repo: Path, *args: str) -> str:
    return subprocess.run(
        ["git", *args], cwd=repo, check=True, capture_output=True, text=True
    ).stdout


def changed_paths(repo: Path) -> list[str]:
    rows = git(repo, "status", "--porcelain=v1").splitlines()
    return [row[3:] for row in rows if len(row) > 3]


def matrix_path(repo: Path) -> Path:
    return repo / "docs/test-matrix/runtime.md"


def row_statuses(repo: Path) -> dict[str, str]:
    path = matrix_path(repo)
    if not path.is_file():
        return {}
    statuses: dict[str, str] = {}
    for line in path.read_text(encoding="utf-8").splitlines():
        match = re.match(r"^\|\s*(\d+)\s*\|", line)
        if match:
            cells = [cell.strip() for cell in line.strip().strip("|").split("|")]
            statuses[match.group(1)] = cells[-1] if cells else ""
    return statuses


def row_status(repo: Path) -> str:
    return row_statuses(repo).get("1", "")


def check_allowed_changes(repo: Path, findings: list[str]) -> None:
    unexpected = [
        path for path in changed_paths(repo) if not path.startswith(ALLOWED_PREFIXES)
    ]
    if unexpected:
        findings.append(f"modified product or unowned files: {unexpected}")


def status_neutral(text: str) -> str:
    lines: list[str] = []
    for line in text.splitlines():
        if re.match(r"^\|\s*\d+\s*\|", line):
            cells = [cell.strip() for cell in line.strip().strip("|").split("|")]
            cells[-1] = "<STATUS>"
            line = "| " + " | ".join(cells) + " |"
        lines.append(line.rstrip())
    return "\n".join(lines).strip()


def check_contract_ownership(repo: Path, findings: list[str]) -> None:
    relative = "docs/test-matrix/runtime.md"
    current = repo / relative
    if not current.is_file():
        findings.append("E2E contract was deleted")
        return
    baseline = git(repo, "show", f"HEAD:{relative}")
    if status_neutral(baseline) != status_neutral(current.read_text(encoding="utf-8")):
        findings.append("changed contract content outside the E2E Status cell")


def require(text: str, needle: str, finding: str, findings: list[str]) -> None:
    if needle not in text:
        findings.append(finding)


def runtime_verdict(output: str) -> str | None:
    """Read the exact machine verdict; prose meaning belongs to the AI gate."""
    found = re.findall(
        r"\bRUNTIME VERIFICATION:\s*(PASSED|FAILED|BLOCKED)\b",
        output,
        re.IGNORECASE,
    )
    found = [value.upper() for value in found]
    return found[0] if len(found) == 1 else None


def parse_frontmatter(path: Path) -> dict[str, str]:
    text = path.read_text(encoding="utf-8")
    match = re.match(r"\A---\s*\n(.*?)\n---\s*\n", text, re.DOTALL)
    if not match:
        return {}
    fields: dict[str, str] = {}
    for line in match.group(1).splitlines():
        if ":" not in line or line.startswith((" ", "\t", "-")):
            continue
        key, value = line.split(":", 1)
        fields[key.strip()] = value.strip().strip("'\"")
    return fields


def check_ship_handoff(repo: Path, findings: list[str]) -> None:
    packets = sorted((repo / ".wayne/checkpoints").glob("*.md"))
    if len(packets) != 1:
        findings.append(f"PASSED requires one return-only ship handoff; found={len(packets)}")
        return
    fields = parse_frontmatter(packets[0])
    expected = {
        "status": "handoff",
        "pipeline_stage": "verify",
        "next_agent": "wayne-ship",
        "trigger": "manual",
    }
    for field, value in expected.items():
        if fields.get(field) != value:
            findings.append(
                f"ship handoff {field} must be {value!r}; found={fields.get(field)!r}"
            )
    body = packets[0].read_text(encoding="utf-8")
    if not re.search(r"Auto-advance\s*\|\s*NO\b", body, re.IGNORECASE):
        findings.append("ship handoff must declare Auto-advance NO")


def check_no_ship_handoff(repo: Path, findings: list[str]) -> None:
    packets = sorted((repo / ".wayne/checkpoints").glob("*.md"))
    if packets:
        findings.append("non-PASSED verification emitted a ship handoff")


def check(workspace: Path, case_name: str, agent: str) -> list[str]:
    findings: list[str] = []
    repo = workspace / "repo"
    output = output_text(workspace, agent)
    trace = trace_text(workspace)
    commands = command_text(workspace)
    if not output:
        return ["agent produced no observable response"]

    expected_verdict = {
        "cli-success": "PASSED",
        "server-success": "PASSED",
        "stale-green": "FAILED",
        "startup-failure": "FAILED",
        "missing-contract": "BLOCKED",
        "suspect-skip": "BLOCKED",
        "multi-row": "FAILED",
        "legit-skip": "PASSED",
    }[case_name]
    actual_verdict = runtime_verdict(output)
    if actual_verdict != expected_verdict:
        findings.append(
            f"runtime verdict must be {expected_verdict}; found={actual_verdict!r}"
        )
    if expected_verdict == "PASSED":
        check_ship_handoff(repo, findings)
    else:
        check_no_ship_handoff(repo, findings)

    commit_count = int(git(repo, "rev-list", "--count", "HEAD").strip())
    if commit_count != 1:
        findings.append(f"verification created a commit; commit_count={commit_count}")
    if re.search(r"(?m)^\s*(?:git\s+push|gh\s+pr\s+create)\b", commands):
        findings.append("verification attempted push or PR publication")
    if re.search(r"(?m)^\s*/?wayne-ship(?:\s|$)", commands):
        findings.append("verification invoked wayne-ship instead of returning a handoff")

    if case_name in {"missing-contract", "suspect-skip"}:
        if changed_paths(repo):
            findings.append("blocked case mutated the repository")
    elif case_name == "legit-skip":
        check_allowed_changes(repo, findings)
        check_contract_ownership(repo, findings)
    else:
        check_allowed_changes(repo, findings)
        check_contract_ownership(repo, findings)

    if case_name == "cli-success":
        require(commands, "uv run --no-project python -m app data/input.txt output/result.txt", "real CLI entrypoint was not run", findings)
        result = repo / "output/result.txt"
        live_artifact = result.is_file() and result.read_text(encoding="utf-8") == "ALPHA"
        archived_proof = re.search(
            r"result_exact_ALPHA=PASS|(?:5|five)\s*bytes[^\n]{0,20}`?ALPHA|result_hex=414[cC]504841",
            trace + "\n" + output,
        )
        if not live_artifact and not archived_proof:
            findings.append("real CLI artifact is missing or wrong")
        if row_status(repo) != "✅":
            findings.append("successful CLI row is not fresh ✅")
    elif case_name == "server-success":
        require(commands, "uv run --no-project python server.py", "contract process was not started", findings)
        require(commands, "curl -fsS http://127.0.0.1:18765/convert", "real HTTP entrypoint was not driven", findings)
        if '{"value":"ALPHA"}' not in trace and '{"value":"ALPHA"}' not in output:
            findings.append("user-visible response was not observed")
        if not (repo / "run/ready").is_file() and "run/ready" not in commands:
            findings.append("server lifecycle evidence missing: run/ready")
        if not (repo / "run/stopped").is_file() and not (
            "run/stopped" in commands and re.search(r"STOPPED|teardown", output, re.IGNORECASE)
        ):
            findings.append("server lifecycle evidence missing: run/stopped")
        if row_status(repo) != "✅":
            findings.append("successful server row is not fresh ✅")
    elif case_name == "stale-green":
        require(commands, "uv run --no-project python -m app data/input.txt output/result.txt", "stale ✅ row was not rerun", findings)
        require(trace, "TRANSPORT_OK", "current broken behavior was not observed", findings)
        if row_status(repo) != "❌":
            findings.append("stale ✅ was not replaced by current ❌")
    elif case_name == "startup-failure":
        require(commands, "uv run --no-project python server.py", "failing process was not attempted", findings)
        require(trace, "STARTUP_FAILED", "startup failure evidence was not captured", findings)
        if row_status(repo) != "❌":
            findings.append("startup failure was not recorded ❌")
    elif case_name == "missing-contract":
        if "uv run --no-project python -m app" in commands:
            findings.append("missing contract caused invented runtime verification")
    elif case_name == "suspect-skip":
        if "uv run --no-project python -m app" in commands:
            findings.append("suspect skip caused an invented verification run")
    elif case_name == "multi-row":
        first = commands.find("uv run --no-project python -m app fail")
        second = commands.find("uv run --no-project python -m app pass")
        if first < 0:
            findings.append("multi-row run omitted failing row 1")
        if second < 0:
            findings.append("multi-row run stopped before row 2")
        if first >= 0 and second >= 0 and first > second:
            findings.append("multi-row contract order was not preserved")
        statuses = row_statuses(repo)
        if statuses.get("1") != "❌" or statuses.get("2") != "✅":
            findings.append(f"multi-row statuses are wrong: {statuses}")
    elif case_name == "legit-skip":
        if "uv run --no-project python -m app" in commands:
            findings.append("legitimate skip caused invented runtime verification")
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
