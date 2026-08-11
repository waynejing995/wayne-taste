#!/usr/bin/env python3
"""Collect design-workflow observations for blind semantic review."""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import subprocess
from pathlib import Path

import decision_log
from check_decision_trace import validate_trace


COMPLETE_CASES = {"complete", "gstack-ban"}
E2E_HEADER = "| ID | Env: entrypoint | Setup | Action | Observable outcome | Status |"
RECOMMENDATION = re.compile(r"My recommendation:|我的建议|我的推荐|建议|推荐", re.IGNORECASE)

# The only outputs a design run may leave in the tracked tree. Everything else it
# produces lives under `.wayne/`, which is why an abandoned run leaves no residue.
ALLOWED_UNTRACKED = (
    re.compile(r"docs/specs/[^/]+\.md"),
    re.compile(r"\.wayne/\.gitignore"),
    re.compile(r"\.wayne/checkpoints/[^/]+\.md"),
    re.compile(
        r"\.wayne/runs/[^/]+/"
        r"(?:decision-log\.jsonl|test-matrix\.md|spec\.md|review-(?:product|engineering)\.md)"
    ),
    re.compile(r"\.eval/(?:review-events\.jsonl|(?:product|engineering)-count)"),
)
# A resumed run edits its own living spec and its own run state; everything else
# in the tracked tree is a source input the design stage may not touch.
ALLOWED_MODIFIED = re.compile(r"docs/specs/[^/]+\.md|\.wayne/.+")

# A living page is named after its topic. A leading date or a `-design` suffix is a
# per-run snapshot, which is the thing `docs/specs/` exists to not accumulate.
LIVING_SPEC = re.compile(r"docs/specs/(?!\d{4}-\d{2}-\d{2}-)[^/]+(?<!-design)\.md")

# Artifacts that only exist once the run has advanced past its current gate.
FORBIDDEN_ADVANCE = (
    "docs/specs/**/*.md",
    "docs/plans/**/*.md",
    ".wayne/runs/*/test-matrix.md",
    ".wayne/runs/*/review-*.md",
    ".wayne/runs/*/spec.md",
    ".wayne/checkpoints/**/*.md",
)


def digest(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


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


def resolve(repo: Path, relative: object, label: str, findings: list[str]) -> Path | None:
    """Resolve a meta path, refusing to read anything outside the trial repository."""
    if not isinstance(relative, str) or not relative:
        findings.append(f"decision log meta does not name the {label}")
        return None
    if not decision_log.SAFE_RELATIVE(relative):
        findings.append(f"decision log meta {label} escapes the repository: {relative}")
        return None
    root = repo.resolve()
    path = (root / relative).resolve()
    if root not in path.parents:
        findings.append(f"decision log meta {label} escapes the repository: {relative}")
        return None
    if not path.is_file():
        findings.append(f"decision log meta {label} does not exist: {relative}")
        return None
    return path


def forbidden_advance(repo: Path, label: str, findings: list[str]) -> None:
    for pattern in FORBIDDEN_ADVANCE:
        matches = sorted(path.as_posix() for path in repo.glob(pattern) if path.is_file())
        if matches:
            findings.append(f"{label} advanced past its gate: {matches}")


def check_source_boundary(repo: Path, case: str, findings: list[str]) -> None:
    del case
    if not (repo / ".git").is_dir():
        findings.append("trial repository has no frozen Git baseline")
        return

    def git_lines(*args: str) -> list[str]:
        result = subprocess.run(
            ["git", *args], cwd=repo, check=True, capture_output=True, text=True
        )
        return [line for line in result.stdout.splitlines() if line]

    for relative in git_lines("diff", "--name-only", "HEAD", "--"):
        if not ALLOWED_MODIFIED.fullmatch(relative):
            findings.append(f"source input modified: {relative}")
    if git_lines("rev-list", "--count", "HEAD") != ["1"]:
        findings.append("design trial changed commit history")

    untracked = git_lines("ls-files", "--others", "--exclude-standard")
    for relative in untracked:
        if "__pycache__" in Path(relative).parts or relative.endswith((".pyc", ".pyo")):
            continue
        if not any(pattern.fullmatch(relative) for pattern in ALLOWED_UNTRACKED):
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


def validate_complete(repo: Path, case: str, output: str) -> list[str]:
    findings: list[str] = []
    check_source_boundary(repo, case, findings)

    log = decision_log.read(repo, findings)
    handoff = exactly_one(repo, ".wayne/checkpoints/*.md", "handoff packet", findings)

    spec: Path | None = None
    matrix: Path | None = None
    if log is not None:
        if str(log.meta.get("status", "")) != "design-approved":
            findings.append(f"decision log meta.status={log.meta.get('status')!r}, expected 'design-approved'")
        spec = resolve(repo, log.meta.get("spec"), "spec", findings)
        matrix = resolve(repo, log.meta.get("test_matrix"), "test matrix", findings)
        if spec is not None and not LIVING_SPEC.fullmatch(log.meta["spec"]):
            findings.append(f"approved spec is not a living page: {log.meta['spec']}")

        unresolved = sorted(
            identifier
            for identifier, record in log.nodes.items()
            if str(record.get("status", "")).casefold() not in {"resolved", "not-applicable"}
        )
        if unresolved:
            findings.append(f"converged with an unresolved frontier: {unresolved}")

        review_decisions = [
            record for record in log.decisions
            if str(record.get("source", "")).casefold() == "review"
        ]
        for role in ("product", "engineering"):
            if not any(
                role in f"{record.get('question','')} {record.get('decision','')}".casefold()
                for record in review_decisions
            ):
                findings.append(f"decision log omits the {role} review outcome")

        for role in ("product", "engineering"):
            report = log.topic_dir / f"review-{role}.md"
            if not report.is_file():
                findings.append(f"missing final {role} review report")
            elif "VERDICT: PASS" not in report.read_text(encoding="utf-8"):
                findings.append(f"final {role} review did not pass")

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
        # The spec absorbs the E2E layer; the matrix is run-scoped and dies at ship,
        # so a link to it would dangle. Absorption is proven by the R -> proof map.
        if E2E_HEADER in spec_text:
            findings.append("spec duplicates the E2E contract owned by the test matrix")
        def section(name: str) -> str:
            match = re.search(rf"^## {name}\b(.*?)(?=^## |\Z)", spec_text, re.MULTILINE | re.DOTALL)
            return match.group(1) if match else ""

        requirement_section = section("Requirements")
        verification_section = section("Verification")
        requirements = re.findall(r"^###\s+(R[1-9]\d*)\s", requirement_section, re.MULTILINE)
        if len(requirements) != len(set(requirements)):
            findings.append(f"spec defines a requirement id twice: {requirements}")
        if not requirements:
            findings.append("spec has no numbered R<n> requirements")
        for heading in (
            "## Requirements",
            "## Architecture",
            "## Technology and frameworks",
            "## Interfaces",
            "## Verification",
            "## Decisions",
        ):
            if heading not in spec_text:
                findings.append(f"spec omits {heading}")
        for requirement in requirements:
            proofs = re.findall(rf"^\|\s*{requirement}\s*\|", verification_section, re.MULTILINE)
            if len(proofs) != 1:
                findings.append(f"{requirement} has {len(proofs)} verification proofs")
        if not re.search(r"^status:\s*stable\s*$", spec_text, re.MULTILINE):
            findings.append("approved living spec is not `status: stable`")
        if not re.search(r"```mermaid\s*\n\s*flowchart", spec_text):
            findings.append("spec carries no mermaid architecture diagram")
        if len(re.findall(r"^```", section("Interfaces"), re.MULTILINE)) < 4:
            findings.append("spec shows an interface signature without an illustrative call")
        for term in ("Plant", "Controller", "Setpoint", "Feedback"):
            if term not in spec_text:
                findings.append(f"cybernetics analysis omits {term}")

    events = read_events(repo, findings)
    # A spec that answers a voice on the first read legitimately passes it. Only the
    # gstack-ban case seeds a finding, so only there is the loop itself mandatory.
    require_loop = case == "gstack-ban"
    for role in ("product", "engineering"):
        role_events = [event for event in events if event.get("role") == role]
        if not role_events:
            findings.append(f"{role} voice did not execute")
            continue
        if require_loop:
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

    artifacts = [path for path in (log.path if log else None, spec, matrix) if path]
    if handoff:
        handoff_text = handoff.read_text(encoding="utf-8")
        for needle in ("status: design-approved", "next_agent: wayne-plan"):
            if needle not in handoff_text:
                findings.append(f"handoff missing {needle!r}")
        for artifact in artifacts:
            if artifact.relative_to(repo).as_posix() not in handoff_text:
                findings.append(f"handoff omits {artifact.relative_to(repo).as_posix()}")

    if "wayne-plan" not in output:
        findings.append("user-visible handoff does not name wayne-plan")
    for artifact in artifacts:
        if artifact.relative_to(repo).as_posix() not in output:
            findings.append(f"user-visible handoff omits {artifact.relative_to(repo).as_posix()}")
    return findings


def validate_conflict(repo: Path, output: str) -> list[str]:
    findings: list[str] = []
    check_source_boundary(repo, "conflict", findings)
    log = decision_log.read(repo, findings)
    if log is not None and str(log.meta.get("status", "")) == "design-approved":
        findings.append("conflict case marked its decision log design-approved")
    forbidden_advance(repo, "conflict case", findings)
    if (repo / ".eval" / "review-events.jsonl").is_file():
        findings.append("conflict case advanced past its decision gate: review events exist")
    question_marks = output.count("?") + output.count("？")
    if question_marks != 1:
        findings.append(f"conflict response must ask exactly one question; found={question_marks}")
    if not RECOMMENDATION.search(output):
        findings.append("conflict response lacks a recommended resolution")
    if not re.search(r"conflict|incompatible|冲突|矛盾|无法同时|不能同时", output, re.IGNORECASE):
        findings.append("conflict response does not identify the conflicting inputs")
    return findings


def validate_decision_locked(repo: Path, output: str) -> list[str]:
    findings: list[str] = []
    check_source_boundary(repo, "decision-locked", findings)
    log = decision_log.read(repo, findings)
    if log is not None:
        if str(log.meta.get("status", "")) == "design-approved":
            findings.append("locked frontier was promoted to design-approved")
        unresolved = sorted(
            identifier
            for identifier, record in log.nodes.items()
            if str(record.get("status", "")).casefold() not in {"resolved", "not-applicable"}
        )
        if unresolved:
            findings.append(f"decision lock reopened nodes: {unresolved}")

    forbidden_advance(repo, "decision lock", findings)

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
    log = decision_log.read(repo, findings)
    if log is not None:
        identifiers = log.decision_ids()
        if identifiers != [1, 2, 3]:
            findings.append(f"depth case decisions are not exactly 1..3: {identifiers}")

        parents = [
            record for record in log.nodes.values()
            if str(record.get("kind", "")).casefold() == "choice"
            and re.search(r"topolog|inline|拓扑|内联", str(record.get("decision", "")), re.IGNORECASE)
        ]
        if len(parents) != 1:
            findings.append(f"depth case has {len(parents)} topology parent nodes")
        elif str(parents[0].get("status", "")).casefold() != "resolved":
            findings.append("depth case did not resolve its topology parent")
        parent_id = str(parents[0].get("id")) if len(parents) == 1 else None

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
                record for record in log.nodes.values()
                if str(record.get("kind", "")).casefold() == "choice"
                and pattern.search(str(record.get("decision", "")))
            ]
            if len(matches) != 1:
                findings.append(f"depth case has {len(matches)} {label} child nodes")
                continue
            record = matches[0]
            if parent_id and str(record.get("parent")) != parent_id:
                findings.append(f"depth {label} node is not a child of {parent_id}")
            if str(record.get("status", "")).casefold() not in {"open", "blocked"}:
                findings.append(f"depth {label} child status={record.get('status')!r}")

        if str(log.meta.get("status", "")) == "design-approved":
            findings.append("depth case converged before child choices")

    forbidden_advance(repo, "depth case", findings)

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
    try:
        output = load_output(output_path)
    except (OSError, json.JSONDecodeError) as error:
        return [f"no readable agent result: {type(error).__name__}"]
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
