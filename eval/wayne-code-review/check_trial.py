#!/usr/bin/env python3
"""Collect Code Review behavior evidence for blind semantic review."""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import subprocess
from pathlib import Path

from check_dual_evidence import validate_evidence


CASES = {
    "security-only-routing",
    "security-safe-neighbor",
    "dataflow-half-migration",
    "disagreement-synthesis",
}
DECOYS = (
    "unused import",
    "unused `sys`",
    "missing docstring",
    "formatting",
    "style",
    "spacing",
    "pep 8",
    "destination_path=",
)


def load_output(path: Path) -> str:
    text = path.read_text(encoding="utf-8")
    try:
        data = json.loads(text)
    except json.JSONDecodeError:
        return text.strip()
    if isinstance(data, dict) and isinstance(data.get("result"), str):
        return data["result"].strip()
    return text.strip()


def patch_sha(repo: Path) -> str:
    result = subprocess.run(
        ["git", "diff", "--binary", "--full-index", "HEAD", "--"],
        cwd=repo,
        check=True,
        capture_output=True,
    )
    return hashlib.sha256(result.stdout).hexdigest()


def check_no_mutation(workspace: Path, repo: Path, findings: list[str]) -> None:
    status_path = workspace / "repo-start-status.txt"
    diff_path = workspace / "repo-start-diff.sha256"
    if not status_path.is_file() or not diff_path.is_file():
        findings.append("missing frozen Git start evidence")
        return
    current_status = subprocess.run(
        ["git", "status", "--porcelain=v1", "--untracked-files=all"],
        cwd=repo,
        check=True,
        capture_output=True,
        text=True,
    ).stdout
    if current_status != status_path.read_text(encoding="utf-8"):
        findings.append("review changed Git tracked/untracked path state")
    current_diff = patch_sha(repo)
    if current_diff != diff_path.read_text(encoding="utf-8").strip():
        findings.append("review changed the frozen tracked diff")
    if subprocess.run(["git", "diff", "--cached", "--quiet"], cwd=repo).returncode != 0:
        findings.append("review staged changes")
    commits = subprocess.run(
        ["git", "rev-list", "--count", "HEAD"], cwd=repo, check=True, capture_output=True, text=True
    ).stdout.strip()
    if commits != "1":
        findings.append(f"review changed commit history: count={commits}")


def review_rows(evidence_dir: Path) -> dict[str, dict[str, object]]:
    rows: dict[str, dict[str, object]] = {}
    for provider in ("claude", "codex"):
        path = evidence_dir / f"{provider}-review.json"
        if path.is_file():
            data = json.loads(path.read_text(encoding="utf-8"))
            if isinstance(data, dict):
                rows[provider] = data
    return rows


def finding_text(row: dict[str, object]) -> str:
    return json.dumps(row, ensure_ascii=False).lower()


def has_shell_finding(review: dict[str, object]) -> bool:
    for row in review.get("findings", []):
        if not isinstance(row, dict):
            continue
        text = finding_text(row)
        if (
            row.get("severity") == "CRITICAL"
            and row.get("file") == "src/export.py"
            and row.get("line") == 8
            and "shell" in text
            and ("inject" in text or "注入" in text or "arbitrary command" in text)
        ):
            return True
    return False


def reports_decoy(output: str) -> str | None:
    for decoy in DECOYS:
        if re.search(
            rf"(?:\[INFORMATIONAL\]|SEVERITY:\s*INFORMATIONAL)[^\n]*{re.escape(decoy)}",
            output,
            re.IGNORECASE,
        ):
            return decoy
    return None


def check_security(
    output: str,
    evidence_dir: Path,
    vulnerable: bool,
    expected_patch: str,
    findings: list[str],
) -> None:
    findings.extend(validate_evidence(evidence_dir, "security", expected_patch))
    rows = review_rows(evidence_dir)
    if vulnerable:
        if "src/export.py" not in output.lower():
            findings.append("review omits vulnerable file src/export.py")
        if not re.search(r"src/export\.py:(?:8|[1-8]-[8-9])|第\s*8\s*行", output, re.IGNORECASE):
            findings.append("review omits vulnerable line 8")
        if "critical" not in output.lower():
            findings.append("command injection is not classified CRITICAL")
        if not (
            re.search(r"shell\s*(?:command\s*)?injection|command injection|命令注入", output, re.IGNORECASE)
            or ("shell=true" in output.lower() and re.search(r"arbitrary command|执行.*命令", output, re.IGNORECASE))
        ):
            findings.append("review omits shell command injection mechanism")
        for provider in ("claude", "codex"):
            if provider in rows and not has_shell_finding(rows[provider]):
                findings.append(f"{provider} raw review misses exact shell-injection finding")
    else:
        injection = r"(?:shell\s*(?:command\s*)?injection|command injection|命令注入)"
        severity = r"(?:\[?(?:CRITICAL|INFORMATIONAL)\]?|SEVERITY\s*:\s*(?:CRITICAL|INFORMATIONAL))"
        if re.search(
            rf"(?:{severity}[^\n]*{injection}|{injection}[^\n]*{severity})",
            output,
            re.IGNORECASE,
        ):
            findings.append("safe argv implementation is falsely reported as shell injection")
        if not re.search(r"no findings|0\s+(?:findings|issues)|未发现.*安全|无.*安全.*问题", output, re.IGNORECASE):
            findings.append("safe security review does not report a clean result")
        for provider, review in rows.items():
            if review.get("verdict") != "NO FINDINGS" or review.get("findings") != []:
                findings.append(f"{provider} raw review reports a false positive")
    decoy = reports_decoy(output)
    if decoy:
        findings.append(f"security-only review reports non-security decoy: {decoy!r}")


def check_dataflow(
    output: str, evidence_dir: Path, expected_patch: str, findings: list[str]
) -> None:
    findings.extend(validate_evidence(evidence_dir, "dataflow", expected_patch))
    lower = output.lower()
    required = {
        "src/delivery/retry.py": "stale consumer path",
        "teamconfig.timeout_ms": "new state owner",
        "resolve_timeout": "consumer-facing resolver",
        "default_timeout_ms": "old source",
    }
    for needle, label in required.items():
        if needle not in lower:
            findings.append(f"dataflow review omits {label}: {needle}")
    if not re.search(r"retry\.py:(?:[1-7]-)?7|line\s*7|第\s*7\s*行", output, re.IGNORECASE):
        findings.append("dataflow review omits stale consumer line 7")
    if "critical" not in lower:
        findings.append("wrong-value half migration is not CRITICAL")
    if not re.search(r"2400|wrong value|错误值|half[- ]migration|未完成.*迁移", output, re.IGNORECASE):
        findings.append("dataflow review omits second-team wrong-value consequence")


def check_disagreement(output: str, findings: list[str]) -> None:
    lower = output.lower()
    for needle in ("shell-command-injection", "src/archive.py", "critical", "claude", "codex"):
        if needle not in lower:
            findings.append(f"synthesis omits confirmed finding evidence: {needle}")
    if not re.search(r"dual[- ]voice|confirmed|双.*确认", output, re.IGNORECASE):
        findings.append("shared shell finding is not marked dual-voice confirmed")
    if "overwrite-default-compatibility" not in lower:
        findings.append("synthesis omits compatibility disagreement")
    if not re.search(r"not_a_finding|not a finding|不是.*finding|不构成.*问题", output, re.IGNORECASE):
        findings.append("synthesis omits Codex NOT_A_FINDING position")
    if not re.search(r"unresolved|未解决|保留分歧", output, re.IGNORECASE):
        findings.append("synthesis resolves the disagreement instead of preserving it")
    if not re.search(r"verdict\s*[:：]?\s*fail|review.*fail|结果.*fail", output, re.IGNORECASE):
        findings.append("unresolved confirmed CRITICAL does not produce FAIL")
    if not re.search(r"runtime.*unverified|运行时.*未验证", output, re.IGNORECASE):
        findings.append("synthesis does not preserve runtime UNVERIFIED")


def check(
    workspace: Path,
    case_name: str,
    output_path: Path,
    evidence_dir: Path | None = None,
) -> list[str]:
    findings: list[str] = []
    repo = workspace / "repo"
    check_no_mutation(workspace, repo, findings)
    try:
        output = load_output(output_path)
    except (OSError, json.JSONDecodeError) as error:
        findings.append(f"no readable review result: {type(error).__name__}")
        return findings
    if not output:
        findings.append("review produced no user-visible output")
        return findings
    if case_name == "disagreement-synthesis":
        if (workspace / "review-evidence").exists():
            findings.append("synthesis-only case invoked reviewers")
        check_disagreement(output, findings)
        return findings
    selected_evidence = evidence_dir or workspace / "review-evidence"
    if not (selected_evidence / "manifest.json").is_file():
        findings.append("missing deterministic Claude+Codex review evidence")
        return findings
    expected_patch = patch_sha(repo)
    if case_name == "security-only-routing":
        check_security(output, selected_evidence, True, expected_patch, findings)
    elif case_name == "security-safe-neighbor":
        check_security(output, selected_evidence, False, expected_patch, findings)
    elif case_name == "dataflow-half-migration":
        check_dataflow(output, selected_evidence, expected_patch, findings)
    return findings


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("workspace", type=Path)
    parser.add_argument("--case", choices=sorted(CASES), required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--evidence", type=Path)
    args = parser.parse_args()
    findings = check(
        args.workspace.resolve(),
        args.case,
        args.output.resolve(),
        args.evidence.resolve() if args.evidence else None,
    )
    result = {
        "semantic_verdict": "AI_REVIEW_REQUIRED",
        "case": args.case,
        "observations": findings,
    }
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
