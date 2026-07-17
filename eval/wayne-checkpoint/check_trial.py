#!/usr/bin/env python3
"""Validate a Wayne Checkpoint handoff trial against the frozen route contract."""

from __future__ import annotations

import argparse
import json
import re
import subprocess
from pathlib import Path


HARNESS = Path(__file__).resolve().parent
REPO_ROOT = HARNESS.parent.parent
CASES = {
    "plan-regression": ("plan", "none", "wayne-work", "docs/plans/approved-plan.md"),
    "fix-now": ("triage", "fix-now", "wayne-test-design", ".wayne/triage/normalize-whitespace.md"),
    "needs-plan": ("triage", "needs-plan", "wayne-test-design", ".wayne/triage/shared-normalization.md"),
    "escalate-architecture": ("triage", "escalate-architecture", "wayne-mind-explode", ".wayne/triage/retry-controller.md"),
    "external": ("triage", "escalate-incident", "", ".wayne/triage/provider-outage.md"),
}


def load_output(path: Path) -> str:
    text = path.read_text(encoding="utf-8")
    if path.suffix == ".json":
        payload = json.loads(text)
        return str(payload.get("result", ""))
    return text


def parse_frontmatter(text: str) -> tuple[dict[str, str], str]:
    match = re.match(r"^---\s*\n(.*?)\n---\s*\n(.*)$", text, re.DOTALL)
    if not match:
        return {}, text
    values: dict[str, str] = {}
    for line in match.group(1).splitlines():
        if ":" not in line or line.startswith((" ", "-")):
            continue
        key, value = line.split(":", 1)
        values[key.strip()] = value.strip().strip('"\'')
    return values, match.group(2)


def product_diff(repo: Path) -> list[str]:
    result = subprocess.run(
        ["git", "-C", str(repo), "status", "--short", "--untracked-files=all"],
        check=True,
        capture_output=True,
        text=True,
    )
    findings = []
    for line in result.stdout.splitlines():
        path = line[3:]
        if path and not path.startswith(".wayne/"):
            findings.append(f"product/input modified: {line}")
    return findings


def validate(workspace: Path, case: str, output_path: Path) -> list[str]:
    findings: list[str] = []
    repo = workspace / "repo"
    output = load_output(output_path)
    findings.extend(product_diff(repo))
    packets = sorted((repo / ".wayne" / "checkpoints").glob("*.md"))
    stage, route, expected_agent, snapshot = CASES[case]

    if not expected_agent:
        if packets:
            findings.append(f"external route wrote Wayne handoff: {[p.name for p in packets]}")
        if "NO_WAYNE_HANDOFF" not in output or "escalate-incident" not in output:
            findings.append("external route must fail loud with NO_WAYNE_HANDOFF and verdict")
        return findings

    if len(packets) != 1:
        findings.append(f"expected exactly one handoff packet; found={[p.name for p in packets]}")
        return findings

    text = packets[0].read_text(encoding="utf-8")
    frontmatter, body = parse_frontmatter(text)
    expected_fields = {
        "status": "handoff",
        "pipeline_stage": stage,
        "next_agent": expected_agent,
        "trigger": "manual",
    }
    if stage == "triage":
        expected_fields.update({"route": route, "snapshot": snapshot})
    for key, expected in expected_fields.items():
        actual = frontmatter.get(key, "")
        if actual != expected:
            findings.append(f"{key} must be {expected!r}; found={actual!r}")

    agent = frontmatter.get("next_agent", "")
    if not re.fullmatch(r"wayne-[a-z0-9-]+", agent):
        findings.append(f"next_agent is not one Skill slug: {agent!r}")
    elif not (REPO_ROOT / agent / "SKILL.md").is_file():
        findings.append(f"next_agent Skill does not exist: {agent!r}")

    required_body = [expected_agent, "manual", "Auto-advance", "out of scope"]
    if stage == "triage":
        required_body.extend([snapshot, "acceptance"])
    else:
        required_body.append(snapshot)
    for needle in required_body:
        if needle.lower() not in body.lower():
            findings.append(f"handoff body missing {needle!r}")
    if not re.search(r"Auto-advance\s*\|\s*NO\b", body, re.IGNORECASE):
        findings.append("handoff must state Auto-advance NO")
    if re.search(r"\b(?:invoke|run|start)(?:d|s|ing)?\s+" + re.escape(expected_agent) + r"\b", output, re.IGNORECASE):
        findings.append("user-visible result claims downstream invocation")
    if not re.search(r"manual|手动", output, re.IGNORECASE):
        findings.append("user-visible result omits manual trigger")
    if expected_agent not in output:
        findings.append("user-visible result omits next agent")
    return findings


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
