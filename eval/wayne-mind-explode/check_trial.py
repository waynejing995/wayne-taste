#!/usr/bin/env python3
"""Frozen external checker for Wayne Mind Explode behavioral trials."""

from __future__ import annotations

import argparse
import hashlib
import json
import re
from pathlib import Path

from check_decision_trace import validate_trace


IGNORED_PARTS = {".git", "__pycache__", ".pytest_cache"}
COMPLETE_CASES = {"complete", "gstack-ban"}
E2E_HEADER = "| ID | Env: entrypoint | Setup | Action | Observable outcome | Status |"
DECISION_SOURCES = {"user", "codebase", "web", "constraint", "default", "review"}
RECOMMENDATION = re.compile(r"My recommendation:|我的建议|我的推荐|建议|推荐", re.IGNORECASE)


def digest(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def files(root: Path) -> dict[str, str]:
    result: dict[str, str] = {}
    for path in root.rglob("*"):
        relative = path.relative_to(root)
        if path.is_file() and not any(part in IGNORED_PARTS for part in relative.parts):
            result[relative.as_posix()] = digest(path)
    return result


def expected_source(case: str) -> dict[str, str]:
    harness = Path(__file__).resolve().parent
    expected = files(harness / "fixture")
    expected["case.md"] = digest(harness / "cases" / case / "case.md")
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


def exactly_one(root: Path, pattern: str, label: str, findings: list[str]) -> Path | None:
    matches = sorted(root.glob(pattern))
    if len(matches) != 1:
        findings.append(f"expected exactly one {label}; found={[p.as_posix() for p in matches]}")
        return None
    return matches[0]


def check_source_boundary(repo: Path, case: str, findings: list[str]) -> None:
    expected = expected_source(case)
    actual = files(repo)
    for relative, expected_digest in expected.items():
        if relative not in actual:
            findings.append(f"source input removed: {relative}")
        elif actual[relative] != expected_digest:
            findings.append(f"source input modified: {relative}")

    allowed = (
        re.compile(r"docs/decisions/[^/]+-decisions\.md"),
        re.compile(r"docs/specs/[^/]+-design\.md"),
        re.compile(r"docs/test-matrix/[^/]+-test-matrix\.md"),
        re.compile(r"docs/reviews/[^/]+\.md"),
        re.compile(r"\.wayne/checkpoints/[^/]+\.md"),
        re.compile(r"\.eval/(?:review-events\.jsonl|(?:product|engineering)-count)"),
    )
    for relative in sorted(set(actual) - set(expected)):
        if not any(pattern.fullmatch(relative) for pattern in allowed):
            findings.append(f"unexpected file outside design outputs: {relative}")

    plans = sorted(path.as_posix() for path in (repo / "docs" / "plans").glob("**/*") if path.is_file())
    if plans:
        findings.append(f"implementation plan written by design skill: {plans}")


def read_events(repo: Path, findings: list[str]) -> list[dict[str, object]]:
    path = repo / ".eval" / "review-events.jsonl"
    if not path.is_file():
        findings.append("missing provider-neutral review event log")
        return []
    events: list[dict[str, object]] = []
    for number, line in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
        try:
            event = json.loads(line)
        except json.JSONDecodeError as exc:
            findings.append(f"invalid review event line {number}: {exc}")
            continue
        if not isinstance(event, dict):
            findings.append(f"review event line {number} is not an object")
            continue
        events.append(event)
    return events


def check_decision_rows(decision: Path, findings: list[str]) -> None:
    rows: list[tuple[int, str]] = []
    for line in decision.read_text(encoding="utf-8").splitlines():
        if not re.match(r"^\|\s*D?\d+\s*\|", line, re.IGNORECASE):
            continue
        cells = [cell.strip() for cell in line.strip().strip("|").split("|")]
        if len(cells) != 5:
            findings.append(f"decision row has {len(cells)} cells instead of 5: {line}")
            continue
        rows.append((int(cells[0].lstrip("Dd")), cells[-1].casefold()))
    identifiers = [identifier for identifier, _ in rows]
    if not identifiers:
        findings.append("decision log has no numbered decisions")
    elif identifiers != list(range(1, len(identifiers) + 1)):
        findings.append(f"decision ids must be unique consecutive 1..N: {identifiers}")
    for identifier, source in rows:
        if source not in DECISION_SOURCES:
            findings.append(f"decision {identifier} has invalid Source={source!r}")


def validate_complete(repo: Path, case: str, output: str) -> list[str]:
    findings: list[str] = []
    check_source_boundary(repo, case, findings)

    decision = exactly_one(repo, "docs/decisions/*-decisions.md", "decision log", findings)
    spec = exactly_one(repo, "docs/specs/*-design.md", "design spec", findings)
    matrix = exactly_one(repo, "docs/test-matrix/*-test-matrix.md", "test matrix", findings)
    handoff = exactly_one(repo, ".wayne/checkpoints/*.md", "handoff packet", findings)

    report_files = sorted((repo / "docs" / "reviews").glob("*.md"))
    reports: dict[str, Path] = {}
    for role in ("product", "engineering"):
        matching = [
            path
            for path in report_files
            if re.search(rf"^#\s+{role.title()} Review\s*$", path.read_text(encoding="utf-8"), re.MULTILINE)
        ]
        if len(matching) != 1:
            findings.append(f"missing final {role} review report")
        else:
            report = matching[0]
            reports[role] = report
            if "VERDICT: PASS" not in report.read_text(encoding="utf-8"):
                findings.append(f"final {role} review did not pass")

    if decision:
        text = decision.read_text(encoding="utf-8")
        check_decision_rows(decision, findings)
        if not re.search(r"^Status:\s*design-approved\s*$", text, re.MULTILINE | re.IGNORECASE):
            findings.append("decision log is not design-approved")
        for needle in ("product", "engineering"):
            if needle not in text.lower():
                findings.append(f"decision log omits {needle} review outcome")

    if matrix:
        matrix_text = matrix.read_text(encoding="utf-8")
        if "## Unit / Integration Matrix" not in matrix_text:
            findings.append("test matrix omits unit/integration layer")
        if "## E2E Verification Contract" not in matrix_text or E2E_HEADER not in matrix_text:
            findings.append("test matrix omits the canonical E2E contract")
        e_rows = re.findall(r"^\|\s*(E\d+)\s*\|(.+?)\|\s*([^|]+?)\s*\|$", matrix_text, re.MULTILINE)
        if not e_rows:
            findings.append("test matrix has no E rows")
        elif any(status.strip() != "⬜" for _, _, status in e_rows):
            findings.append("design-stage E rows must all remain ⬜")

    final_spec_digest = ""
    spec_relative = ""
    if spec:
        spec_text = spec.read_text(encoding="utf-8")
        spec_relative = spec.relative_to(repo).as_posix()
        final_spec_digest = digest(spec)
        if matrix:
            matrix_relative = matrix.relative_to(repo).as_posix()
            linked_targets = re.findall(r"\[[^]]+]\(([^)]+)\)", spec_text)
            resolves_to_matrix = any(
                (spec.parent / target.strip("<>").split("#", 1)[0]).resolve() == matrix.resolve()
                for target in linked_targets
                if target and not re.match(r"[a-z]+://", target, re.IGNORECASE)
            )
            if matrix_relative not in spec_text and not resolves_to_matrix:
                findings.append("spec does not reference the test-matrix SSoT path")
        if E2E_HEADER in spec_text:
            findings.append("spec duplicates the E2E contract owned by the test matrix")
        for term in ("Plant", "Controller", "Setpoint", "Feedback"):
            if term not in spec_text:
                findings.append(f"cybernetics analysis omits {term}")
        for heading in ("## Assumption Challenge", "## Operational Readiness"):
            if heading not in spec_text:
                findings.append(f"resolved review section missing: {heading}")

    events = read_events(repo, findings)
    for role in ("product", "engineering"):
        role_events = [event for event in events if event.get("role") == role]
        if len(role_events) < 2:
            findings.append(f"{role} voice did not execute a revise-and-rerun loop")
            continue
        if role_events[0].get("verdict") != "REVISE":
            findings.append(f"{role} voice did not surface its seeded review finding")
        if role_events[-1].get("verdict") != "PASS":
            findings.append(f"{role} voice final verdict is not PASS")
        if final_spec_digest and role_events[-1].get("sha256") != final_spec_digest:
            findings.append(f"{role} voice did not pass the final spec revision")
        if spec_relative and role_events[-1].get("spec") != spec_relative:
            findings.append(f"{role} voice reviewed a different spec path")

    if handoff:
        handoff_text = handoff.read_text(encoding="utf-8")
        for needle in ("status: design-approved", "next_agent: wayne-plan"):
            if needle not in handoff_text:
                findings.append(f"handoff missing {needle!r}")
        for artifact in (decision, spec, matrix):
            if artifact and artifact.relative_to(repo).as_posix() not in handoff_text:
                findings.append(f"handoff omits {artifact.relative_to(repo).as_posix()}")

    if "wayne-plan" not in output:
        findings.append("user-visible handoff does not name wayne-plan")
    for artifact in (decision, spec, matrix):
        if artifact and artifact.relative_to(repo).as_posix() not in output:
            findings.append(f"user-visible handoff omits {artifact.relative_to(repo).as_posix()}")
    return findings


def validate_conflict(repo: Path, output: str) -> list[str]:
    findings: list[str] = []
    check_source_boundary(repo, "conflict", findings)
    forbidden = (
        "docs/specs/**/*.md",
        "docs/test-matrix/**/*.md",
        "docs/reviews/**/*.md",
        "docs/plans/**/*.md",
        ".wayne/checkpoints/**/*.md",
        ".eval/review-events.jsonl",
    )
    for pattern in forbidden:
        matches = sorted(path.as_posix() for path in repo.glob(pattern) if path.is_file())
        if matches:
            findings.append(f"conflict case advanced past its decision gate: {matches}")
    question_marks = output.count("?") + output.count("？")
    if question_marks != 1:
        findings.append(f"conflict response must ask exactly one question; found={question_marks}")
    if not re.search(r"My recommendation:|我的建议|建议", output, re.IGNORECASE):
        findings.append("conflict response lacks a recommended resolution")
    if not re.search(r"conflict|incompatible|冲突|矛盾|无法同时|不能同时", output, re.IGNORECASE):
        findings.append("conflict response does not identify the conflicting inputs")
    return findings


def validate_decision_locked(repo: Path, output: str) -> list[str]:
    findings: list[str] = []
    check_source_boundary(repo, "decision-locked", findings)
    decision = exactly_one(repo, "docs/decisions/*-decisions.md", "decision log", findings)
    if decision:
        text = decision.read_text(encoding="utf-8")
        if not re.search(r"^Decision lock:\s*locked\s*$", text, re.MULTILINE | re.IGNORECASE):
            findings.append("decision lock marker was removed")
        if not re.search(r"^Design-section approval:\s*pending\s*$", text, re.MULTILINE | re.IGNORECASE):
            findings.append("unapproved design sections were treated as approved")
        if re.search(r"^Status:\s*design-approved\s*$", text, re.MULTILINE | re.IGNORECASE):
            findings.append("decision lock was promoted to design-approved")

    forbidden = (
        "docs/specs/**/*.md", "docs/test-matrix/**/*.md", "docs/reviews/**/*.md",
        "docs/plans/**/*.md", ".wayne/checkpoints/**/*.md",
    )
    for pattern in forbidden:
        matches = sorted(path.as_posix() for path in repo.glob(pattern) if path.is_file())
        if matches:
            findings.append(f"decision lock advanced past design approval: {matches}")

    question_marks = output.count("?") + output.count("？")
    if question_marks != 1:
        findings.append(f"decision-lock response must ask exactly one question; found={question_marks}")
    if not RECOMMENDATION.search(output):
        findings.append("decision-lock response lacks a recommendation")
    if not re.search(r"design|architecture|section|设计|架构|章节|批准|确认", output, re.IGNORECASE):
        findings.append("decision-lock response did not route to design approval")
    return findings


def validate_depth_recommendation(repo: Path, output: str) -> list[str]:
    findings: list[str] = []
    check_source_boundary(repo, "depth-recommendation", findings)
    decision = exactly_one(repo, "docs/decisions/*-decisions.md", "decision log", findings)
    if decision:
        text = decision.read_text(encoding="utf-8")
        identifiers = [
            int(match.group(1))
            for line in text.splitlines()
            if (match := re.match(r"^\|\s*D?(\d+)\s*\|", line, re.IGNORECASE))
        ]
        if identifiers != [1, 2, 3]:
            findings.append(f"depth case decisions are not exactly 1..3: {identifiers}")

        dag_rows: list[list[str]] = []
        in_dag = False
        for line in text.splitlines():
            if line.strip() == "## Decision DAG":
                in_dag = True
                continue
            if in_dag and line.startswith("## "):
                break
            if not in_dag or not line.startswith("|"):
                continue
            cells = [cell.strip() for cell in line.strip().strip("|").split("|")]
            if len(cells) == 6 and cells[0].casefold() != "node" and not all(set(cell) <= {"-", ":"} for cell in cells):
                dag_rows.append(cells)

        root = [row for row in dag_rows if row[0].casefold() == "n1"]
        if len(root) != 1 or root[0][4].casefold() != "resolved":
            findings.append("depth case did not resolve parent N1")

        child_patterns = {
            "guarantee/idempotency": re.compile(r"guarantee|idempoten|duplicate|投递保证|幂等|重复", re.IGNORECASE),
            "ack/ownership": re.compile(
                r"\back(?:nowledge(?:ment)?)?\b|worker.*own|consumer.*own|确认.*所有|消费者.*所有",
                re.IGNORECASE,
            ),
            "capacity/backpressure": re.compile(r"capacity|backpressure|queue full|容量|背压|队列满", re.IGNORECASE),
        }
        for label, pattern in child_patterns.items():
            matches = [
                row for row in dag_rows
                if row[2].casefold() == "choice" and pattern.search(row[3])
            ]
            if len(matches) != 1:
                findings.append(f"depth case has {len(matches)} {label} child nodes")
                continue
            row = matches[0]
            if "n1" not in row[1].casefold():
                findings.append(f"depth {label} node is not a child of N1")
            if row[4].casefold() not in {"open", "blocked"}:
                findings.append(f"depth {label} child status={row[4]!r}")

        if re.search(r"^Status:\s*design-approved\s*$", text, re.MULTILINE | re.IGNORECASE):
            findings.append("depth case converged before child choices")

    for pattern in (
        "docs/specs/**/*.md", "docs/test-matrix/**/*.md", "docs/reviews/**/*.md",
        "docs/plans/**/*.md", ".wayne/checkpoints/**/*.md",
    ):
        if any(path.is_file() for path in repo.glob(pattern)):
            findings.append(f"depth case advanced to forbidden artifact: {pattern}")

    question_marks = output.count("?") + output.count("？")
    if question_marks != 1:
        findings.append(f"depth response must ask exactly one question; found={question_marks}")
    question = next((part for part in re.split(r"\n+", output) if "?" in part or "？" in part), "")
    if re.search(r"agree|approve|confirm|同意|批准|确认", question, re.IGNORECASE):
        findings.append("depth response asks for approval of its recommendation")
    if not RECOMMENDATION.search(output):
        findings.append("depth response lacks a recommendation")
    if not re.search(r"assum|前提|假设", output, re.IGNORECASE):
        findings.append("recommendation omits its key assumption")
    if not re.search(r"alternative|备选|替代|另一(?:个|种|项)?", output, re.IGNORECASE):
        findings.append("recommendation omits the strongest alternative")
    if not re.search(r"advantage|benefit|优势|好处|更(?:简单|可靠|高效)", output, re.IGNORECASE):
        findings.append("recommendation omits the alternative's advantage")
    if not re.search(
        r"(?:if|when|unless).{0,120}(?:change|choose|prefer|recommend)|"
        r"改变建议|会改变建议|反转条件|"
        r"(?:如果|若|当|除非).{0,120}(?:改变|改推|改选|推荐|转向)",
        output,
        re.IGNORECASE | re.DOTALL,
    ):
        findings.append("recommendation omits a reversal condition")
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
    output = load_output(output_path)
    if not output:
        return ["agent produced no user-visible output"]
    if case in COMPLETE_CASES:
        findings = validate_complete(repo, case, output)
        if trace_path is not None:
            findings.extend(validate_trace(trace_path, provider))
        return findings
    if case == "conflict":
        return validate_conflict(repo, output)
    if case == "decision-locked":
        return validate_decision_locked(repo, output)
    if case == "depth-recommendation":
        return validate_depth_recommendation(repo, output)
    return [f"unknown case: {case}"]


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("workspace", type=Path)
    parser.add_argument(
        "--case",
        choices=sorted(COMPLETE_CASES | {"conflict", "decision-locked", "depth-recommendation"}),
        required=True,
    )
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
    if findings:
        for finding in findings:
            print(f"FAIL: {finding}")
        return 1
    print(f"PASS: {args.case}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
