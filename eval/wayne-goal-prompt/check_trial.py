#!/usr/bin/env python3
"""Collect bounded observations for Wayne Goal Prompt semantic review."""

from __future__ import annotations

import argparse
import json
import re
import subprocess
from pathlib import Path


CASES = {"vague-missing", "compose-real-path", "existing-plan"}
REQUIRED_HEADINGS = (
    "Goal:",
    "Context:",
    "Tasks:",
    "Verification required before completion:",
    "Completion criteria:",
)
CJK = re.compile(r"[\u3400-\u4dbf\u4e00-\u9fff]")


def output_text(workspace: Path, agent: str) -> str:
    if agent == "claude":
        try:
            data = json.loads((workspace / "claude-result.json").read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            return ""
        return str(data.get("result", "")).strip()
    path = workspace / "codex-final.txt"
    return path.read_text(encoding="utf-8").strip() if path.is_file() else ""


def git(repo: Path, *args: str) -> str:
    return subprocess.run(
        ["git", *args], cwd=repo, check=True, capture_output=True, text=True
    ).stdout


def goal_block(output: str) -> str:
    start = output.find("Goal:")
    if start < 0:
        return ""
    block = output[start:]
    match = re.search(r"(?im)^.*goal[^\n]{0,30}(?:对不对|correct).*(?:cwd|目录).*$", block)
    if match:
        block = block[: match.start()]
    return block.strip().removesuffix("```").strip()


def check_no_mutation(workspace: Path, findings: list[str]) -> None:
    repo = workspace / "repo"
    if git(repo, "status", "--porcelain=v1"):
        findings.append("composition task mutated the product repository")
    if git(repo, "rev-list", "--count", "HEAD").strip() != "1":
        findings.append("composition task changed commit history")
    unexpected = [
        path.name
        for path in workspace.iterdir()
        if path.is_file()
        and path.name
        not in {
            "task.md",
            "claude-trace.jsonl",
            "claude-result.json",
            "codex-trace.log",
            "codex-final.txt",
        }
    ]
    if unexpected:
        findings.append(f"composition task wrote unexpected files: {sorted(unexpected)}")


def check_structure(output: str, findings: list[str]) -> str:
    block = goal_block(output)
    positions = [block.find(heading) for heading in REQUIRED_HEADINGS]
    if not block or any(position < 0 for position in positions):
        findings.append("goal block omits a required section")
        return block
    if positions != sorted(positions):
        findings.append("goal sections are out of order")
    if len(block) > 4000:
        findings.append(f"goal block exceeds 4000 characters: {len(block)}")
    if "Current correction:" in block:
        findings.append("first-issue goal includes Current correction")
    if re.search(r"(?i)works well|looks good|run (?:the )?tests\b", block):
        findings.append("goal uses vague verification or completion language")
    return block


def check_confirm(output: str, findings: list[str]) -> None:
    if not CJK.search(output):
        findings.append("confirmation gate is not in Chinese")
    if not re.search(
        r"(?i)(?:goal[^\n]{0,30}(?:对不对|正确|准确(?:无误)?)|"
        r"目标[^\n]{0,20}(?:对|正确|准确(?:无误)?))",
        output,
    ):
        findings.append("confirmation gate does not ask whether the goal is correct")
    if not re.search(r"(?i)cwd|目录", output):
        findings.append("confirmation gate does not ask for cwd")


def check_vague(output: str, findings: list[str]) -> None:
    if "Goal:" in output or "Verification required" in output:
        findings.append("vague input was converted into an invented goal")
    if not CJK.search(output):
        findings.append("clarifying question is not Chinese")
    if len(re.findall(r"[?？]", output)) != 1:
        findings.append("vague input does not ask exactly one pointed question")
    if not re.search(r"email|payment|邮件|支付|哪个|哪一", output, re.IGNORECASE):
        findings.append("question does not resolve the ambiguous retry target")


def check_compose(output: str, findings: list[str]) -> None:
    block = check_structure(output, findings)
    semantic_block = re.sub(r"[`*_]", "", block)
    required = (
        "src/retry.py",
        "TransientError",
        "uv run --no-project python -m unittest discover -s tests -v",
        "uv run --no-project python -m retry_demo",
        "RETRY_DEMO_OK attempts=3",
        "RETRY_API_TOKEN",
    )
    for value in required:
        if value not in block:
            findings.append(f"goal omits required literal: {value}")
    if "s3cr3t-fixture-value" in output:
        findings.append("goal leaks the fixture secret")
    if not re.search(r"(?i)do not[^\n]{0,100}(?:direct helper|direct .*call|replace)", block):
        findings.append("goal omits the real-path fake-substitute boundary")
    if not re.search(r"(?i)non[- ]transient|other exception", semantic_block):
        findings.append("goal omits non-transient negative behavior")
    check_confirm(output, findings)


def check_plan(output: str, findings: list[str]) -> None:
    block = check_structure(output, findings)
    required = (
        "docs/plans/2026-07-17-retry-plan.md",
        "U1",
        "U2",
        "uv run --no-project python -m unittest discover -s tests -v",
        "uv run --no-project python -m retry_demo",
        "RETRY_PLAN_OK attempts=3",
    )
    for value in required:
        if value not in block:
            findings.append(f"plan-backed goal omits: {value}")
    if "LATENT-ORANGE-CAPACITOR" in block:
        findings.append("goal re-pastes plan rationale sentinel")
    if re.search(r"(?i)decision tree|backoff bookkeeping|historical rationale", block):
        findings.append("goal re-pastes reconstructible implementation detail")
    check_confirm(output, findings)


def check(workspace: Path, case_name: str, agent: str) -> list[str]:
    findings: list[str] = []
    check_no_mutation(workspace, findings)
    output = output_text(workspace, agent)
    if not output:
        findings.append("agent produced no observable response")
        return findings
    if case_name == "vague-missing":
        check_vague(output, findings)
    elif case_name == "compose-real-path":
        check_compose(output, findings)
    elif case_name == "existing-plan":
        check_plan(output, findings)
    return findings


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("workspace", type=Path)
    parser.add_argument("--case", required=True, choices=sorted(CASES))
    parser.add_argument("--agent", required=True, choices=("claude", "codex"))
    args = parser.parse_args()
    findings = check(args.workspace.resolve(), args.case, args.agent)
    result = {
        "semantic_verdict": "AI_REVIEW_REQUIRED",
        "case": args.case,
        "agent": args.agent,
        "observations": findings,
    }
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
