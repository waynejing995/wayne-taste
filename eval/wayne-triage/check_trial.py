#!/usr/bin/env python3
"""Frozen external checker for Wayne Triage behavioral trials."""

from __future__ import annotations

import argparse
import hashlib
import json
import re
from pathlib import Path


HARNESS = Path(__file__).resolve().parent
REPO_ROOT = HARNESS.parent.parent
CASES = {
    "failure",
    "tracker",
    "missing-data",
    "multiple-signal",
    "no-match",
    "approval-denied",
    "architecture",
    "external-owner",
}
INTERNAL = {
    "failure": ("fix-now", "wayne-test-design"),
    "tracker": ("needs-plan", "wayne-test-design"),
    "multiple-signal": ("needs-plan", "wayne-test-design"),
    "architecture": ("escalate-architecture", "wayne-mind-explode"),
}
IGNORED = {".git", "__pycache__", ".pytest_cache"}


def digest(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def manifest(root: Path) -> dict[str, str]:
    result: dict[str, str] = {}
    for path in root.rglob("*"):
        relative = path.relative_to(root)
        if path.is_file() and not any(part in IGNORED for part in relative.parts):
            result[relative.as_posix()] = digest(path)
    return result


def expected_source(case: str) -> dict[str, str]:
    expected = manifest(HARNESS / "fixture")
    expected.update(manifest(HARNESS / "cases" / case))
    return expected


def load_output(path: Path) -> str:
    text = path.read_text(encoding="utf-8")
    try:
        data = json.loads(text)
    except json.JSONDecodeError:
        return text.strip()
    if isinstance(data, dict) and isinstance(data.get("result"), str):
        return data["result"].strip()
    return text.strip()


def parse_frontmatter(path: Path) -> tuple[dict[str, str], str]:
    text = path.read_text(encoding="utf-8")
    match = re.match(r"\A---\s*\n(.*?)\n---\s*\n(.*)\Z", text, re.DOTALL)
    if not match:
        return {}, text
    data: dict[str, str] = {}
    for line in match.group(1).splitlines():
        if ":" not in line or line.startswith((" ", "\t")):
            continue
        key, value = line.split(":", 1)
        data[key.strip()] = value.strip().strip("'\"")
    return data, match.group(2)


def check_source_boundary(repo: Path, case: str, findings: list[str]) -> None:
    expected = expected_source(case)
    actual = manifest(repo)
    for relative, expected_digest in expected.items():
        if relative not in actual:
            findings.append(f"input removed: {relative}")
        elif actual[relative] != expected_digest:
            findings.append(f"input modified: {relative}")

    allowed = (
        re.compile(r"\.wayne/\.gitignore"),
        re.compile(r"\.wayne/triage/\.gitignore"),
        re.compile(r"\.wayne/triage/[^/]+\.md"),
        re.compile(r"\.wayne/triage-reports/[^/]+\.md"),
        re.compile(r"\.wayne/checkpoints/[^/]+\.md"),
    )
    for relative in sorted(set(actual) - set(expected)):
        if not any(pattern.fullmatch(relative) for pattern in allowed):
            findings.append(f"unexpected mutation outside triage state: {relative}")


def evidence_files(repo: Path) -> list[Path]:
    return sorted((repo / ".wayne" / "triage").glob("*.md"))


def checkpoints(repo: Path) -> list[Path]:
    return sorted((repo / ".wayne" / "checkpoints").glob("*.md"))


def check_evidence_shape(
    path: Path, findings: list[str], *, require_hypothesis: bool = True
) -> tuple[dict[str, str], str]:
    frontmatter, body = parse_frontmatter(path)
    required_fields = {
        "slug",
        "date",
        "surface",
        "symptom_class",
        "cause_category",
        "component",
        "est_lines",
        "blast_radius",
        "route",
        "repro_count",
    }
    missing = sorted(required_fields - set(frontmatter))
    if missing:
        findings.append(f"evidence frontmatter missing fields: {missing}")
    headings = ["Symptom", "Repro", "Classify", "Signals", "Attribution", "Route"]
    if require_hypothesis:
        headings.append("Hypothesis")
    for heading in headings:
        if not re.search(rf"^## .*{heading}", body, re.MULTILINE | re.IGNORECASE):
            findings.append(f"evidence missing {heading} section")
    if "[OBSERVED]" not in body:
        findings.append("evidence has no [OBSERVED] claim")
    if not re.search(r"justified_by\s*:", body, re.IGNORECASE):
        findings.append("route does not name a checkable justified_by field")
    route_section = re.search(
        r"^## [^\n]*Route[^\n]*\n(.*?)(?=^## |\Z)",
        body,
        re.MULTILINE | re.DOTALL | re.IGNORECASE,
    )
    body_route = re.search(
        r"^\s*-\s*verdict\s*:\s*`?([a-z-]+)`?",
        route_section.group(1) if route_section else "",
        re.MULTILINE | re.IGNORECASE,
    )
    if not body_route:
        findings.append("evidence Route section omits verdict")
    elif body_route.group(1).lower() != frontmatter.get("route", "").lower():
        findings.append("evidence frontmatter and Route verdict disagree")
    return frontmatter, body


def check_handoff(
    repo: Path,
    evidence: Path,
    route: str,
    expected_agent: str,
    output: str,
    findings: list[str],
) -> None:
    packets = checkpoints(repo)
    if len(packets) != 1:
        findings.append(f"expected one checkpoint handoff; found={[p.as_posix() for p in packets]}")
        return
    frontmatter, body = parse_frontmatter(packets[0])
    expected = {
        "status": "handoff",
        "pipeline_stage": "triage",
        "route": route,
        "snapshot": evidence.relative_to(repo).as_posix(),
        "next_agent": expected_agent,
        "trigger": "manual",
    }
    for field, value in expected.items():
        actual = frontmatter.get(field, "")
        if actual != value:
            findings.append(f"handoff {field} must be {value!r}; found={actual!r}")
    if not (REPO_ROOT / expected_agent / "SKILL.md").is_file():
        findings.append(f"expected next-agent Skill does not exist: {expected_agent}")
    if not re.fullmatch(r"wayne-[a-z0-9-]+", frontmatter.get("next_agent", "")):
        findings.append("handoff next_agent is not one Skill slug")
    for needle in (
        evidence.relative_to(repo).as_posix(),
        expected_agent,
        "manual",
        "Auto-advance",
        "acceptance",
        "out of scope",
    ):
        if needle.lower() not in body.lower():
            findings.append(f"handoff body missing {needle!r}")
    if not re.search(r"Auto-advance\s*\|\s*NO\b", body, re.IGNORECASE):
        findings.append("handoff must state Auto-advance NO")
    if expected_agent not in output:
        findings.append("user-visible result omits next agent")
    if not re.search(r"manual|手动", output, re.IGNORECASE):
        findings.append("user-visible result omits manual trigger")
    if re.search(rf"\b(?:invoked|started|ran)\s+{re.escape(expected_agent)}\b", output, re.IGNORECASE):
        findings.append("user-visible result claims downstream invocation")


def expected_fields(case: str) -> dict[str, str]:
    return {
        "failure": {
            "surface": "failure",
            "symptom_class": "wrong-output",
            "cause_category": "logic",
            "blast_radius": "internal",
            "route": "fix-now",
        },
        "approval-denied": {
            "surface": "failure",
            "symptom_class": "wrong-output",
            "cause_category": "logic",
            "blast_radius": "internal",
            "route": "fix-now",
        },
        "tracker": {
            "surface": "tracker",
            "symptom_class": "enhancement",
            "blast_radius": "shared",
            "route": "needs-plan",
        },
        "multiple-signal": {
            "surface": "tracker",
            "blast_radius": "shared",
            "route": "needs-plan",
        },
        "architecture": {
            "surface": "failure",
            "cause_category": "architecture",
            "route": "escalate-architecture",
        },
        "external-owner": {
            "surface": "failure",
            "route": "route-to-owner",
        },
    }[case]


def validate_complete(repo: Path, case: str, output: str) -> list[str]:
    findings: list[str] = []
    check_source_boundary(repo, case, findings)
    evidence = evidence_files(repo)
    if len(evidence) != 1:
        findings.append(f"expected one evidence SSoT; found={[p.as_posix() for p in evidence]}")
        return findings
    frontmatter, body = check_evidence_shape(
        evidence[0], findings, require_hypothesis=case != "tracker"
    )
    expected = expected_fields(case)
    for field, value in expected.items():
        actual = frontmatter.get(field, "").lower()
        if actual != value:
            findings.append(f"{case} {field} must be {value!r}; found={actual!r}")
    route = expected["route"]
    if route not in output:
        findings.append(f"user-visible result omits route {route}")

    if case in {"failure", "approval-denied"}:
        if "tests.test_tokenizer" not in body or not re.search(r"fail|失败|error", body, re.IGNORECASE):
            findings.append("fix route lacks the supplied failing repro")
    if case == "tracker":
        if not re.search(r"enhancement", output, re.IGNORECASE):
            findings.append("tracker output omits enhancement category")
        if "ready-for-agent" not in output:
            findings.append("tracker output omits ready-for-agent state")
    if case == "multiple-signal":
        if frontmatter.get("cause_category", "").lower() not in {"config", "logic"}:
            findings.append("multiple-signal cause_category must preserve config or logic ownership")
        if frontmatter.get("symptom_class", "").lower() not in {"bug", "crash", "config-env"}:
            findings.append("multiple-signal symptom_class must preserve bug, crash, or config-env")
        for signal in ("stack_trace", "env_skew"):
            if not re.search(rf"{signal}\s*:\s*true", body, re.IGNORECASE):
                findings.append(f"multiple-signal evidence omits {signal}: true")
        if not re.search(r"ready-for-agent", output, re.IGNORECASE):
            findings.append("multiple-signal tracker output omits ready-for-agent")
        if not re.search(r"(?:category\s*[=:]\s*)?bug", output, re.IGNORECASE):
            findings.append("multiple-signal tracker output omits bug category")
    if case == "architecture":
        try:
            count = int(frontmatter.get("repro_count", "0"))
        except ValueError:
            count = 0
        if count < 3 and not re.search(r"(?:three|3).*(?:fix|attempt)", body, re.IGNORECASE):
            findings.append("architecture route omits three failed fixes")

    if case in INTERNAL:
        route, agent = INTERNAL[case]
        check_handoff(repo, evidence[0], route, agent, output, findings)
    elif case == "approval-denied":
        if checkpoints(repo):
            findings.append("approval-denied case emitted a checkpoint")
        if re.search(r"handoff (?:generated|created)|交接包已生成", output, re.IGNORECASE):
            findings.append("approval-denied output claims a handoff")
    elif case == "external-owner":
        if checkpoints(repo):
            findings.append("external route emitted a Wayne checkpoint")
        report_fields = {
            "Executive summary": r"Executive summary|执行摘要",
            "Recommended next action": r"Recommended next action|建议(?:的)?下一步",
            "Acceptance": r"Acceptance|验收",
            "Out of scope": r"Out of scope|超出范围|范围外",
        }
        for label, pattern in report_fields.items():
            if not re.search(pattern, output, re.IGNORECASE):
                findings.append(f"external triage report missing {label!r}")
    return findings


def validate_missing(repo: Path, output: str) -> list[str]:
    findings: list[str] = []
    check_source_boundary(repo, "missing-data", findings)
    if evidence_files(repo):
        findings.append("missing-data case wrote evidence before data existed")
    if checkpoints(repo):
        findings.append("missing-data case emitted a handoff")
    question_marks = output.count("?") + output.count("？")
    if question_marks != 1:
        findings.append(f"missing-data response must ask exactly one question; found={question_marks}")
    if not re.search(
        r"where|how|fetch|source|command|content|body|哪里|在哪|如何|怎么|来源|拉取|获取|命令|内容|正文",
        output,
        re.IGNORECASE,
    ):
        findings.append("missing-data response does not ask where/how to fetch")
    if re.search(r"fix-now|needs-plan|route-to-owner|ready-for-agent", output, re.IGNORECASE):
        findings.append("missing-data response routed without input")
    return findings


def validate_no_match(repo: Path, output: str) -> list[str]:
    findings: list[str] = []
    check_source_boundary(repo, "no-match", findings)
    evidence = evidence_files(repo)
    if len(evidence) != 1:
        findings.append(f"no-match requires one evidence SSoT; found={len(evidence)}")
        return findings
    frontmatter, body = check_evidence_shape(evidence[0], findings, require_hypothesis=False)
    expected = {
        "surface": "failure",
        "symptom_class": "unknown",
        "cause_category": "unknown",
        "route": "needs-info",
    }
    for field, value in expected.items():
        actual = frontmatter.get(field, "").lower()
        if actual != value:
            findings.append(f"no-match {field} must be {value!r}; found={actual!r}")
    for signal in ("stack_trace", "deadlock_hang", "flaky_pattern", "perf_delta", "env_skew"):
        if not re.search(rf"{signal}\s*:\s*false", body, re.IGNORECASE):
            findings.append(f"no-match must record {signal}: false")
    if checkpoints(repo):
        findings.append("no-match needs-info case emitted a handoff")
    if "needs-info" not in output:
        findings.append("no-match output omits needs-info")
    question_marks = output.count("?") + output.count("？")
    if question_marks != 1:
        findings.append(f"no-match response must ask one question; found={question_marks}")
    return findings


def validate(workspace: Path, case: str, output_path: Path) -> list[str]:
    repo = workspace / "repo"
    if not repo.is_dir():
        return [f"missing trial repository: {repo}"]
    output = load_output(output_path)
    if not output:
        return ["agent produced no user-visible output"]
    if case in INTERNAL or case in {"approval-denied", "external-owner"}:
        return validate_complete(repo, case, output)
    if case == "missing-data":
        return validate_missing(repo, output)
    if case == "no-match":
        return validate_no_match(repo, output)
    return [f"unknown case: {case}"]


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
