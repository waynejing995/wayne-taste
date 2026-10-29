#!/usr/bin/env python3
"""Collect design-workflow observations for blind semantic review."""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import subprocess
from fnmatch import fnmatch
from pathlib import Path

import decision_log
from check_decision_trace import validate_trace


COMPLETE_CASES = {"complete", "gstack-ban"}
E2E_HEADER = "| ID | Env: entrypoint | Setup | Action | Observable outcome | Status |"
RECOMMENDATION = re.compile(r"My recommendation:|我的建议|我的推荐|建议|推荐", re.IGNORECASE)

# The only outputs a design run may leave, bound to the one topic it is designing.
# The repository receives the living spec and the glossary; run-scoped artifacts
# live under `<state>`, which is never committed. Each side has its own allowlist,
# and a file outside its side's allowlist is a finding. A second topic's artifacts
# are scope drift, not output.
HARNESS_STATE = re.compile(r"\.eval/(?:review-events\.jsonl|(?:product|engineering)-count)")


def writable(topic: str | None) -> tuple[re.Pattern[str], ...]:
    # Without a readable topic nothing is writable: an unknown topic is the moment
    # to tighten, not the moment to allow every spec.
    slug = re.escape(topic) if topic else r"(?!)"
    return (
        re.compile(rf"docs/specs/{slug}\.md"),
        re.compile(r"GLOSSARY\.md"),
        HARNESS_STATE,
    )


def writable_state(topic: str | None) -> tuple[re.Pattern[str], ...]:
    slug = re.escape(topic) if topic else r"(?!)"
    return (
        re.compile(rf"runs/{slug}/(?:decision-log\.jsonl|spec\.md|test-matrix\.md|review-(?:product|engineering)\.md)"),
        re.compile(r"checkpoints/[^/]+\.md"),
    )

# A living page is named after its topic. A leading date or a `-design` suffix is a
# per-run snapshot, which is the thing `docs/specs/` exists to not accumulate.
LIVING_SPEC = re.compile(r"docs/specs/(?!\d{4}-\d{2}-\d{2}-)[^/]+(?<!-design)\.md")

# Artifacts that only exist once the run has advanced past its current gate. They
# are scoped to this run's topic: a living spec for some other topic is a
# repository input, not evidence that this run advanced.
def forbidden_patterns(topic: str | None) -> tuple[str, ...]:
    slug = topic or "*"
    return (
        f"docs/specs/{slug}.md",
        "docs/plans/**/*.md",
        f"state/runs/{slug}/test-matrix.md",
        f"state/runs/{slug}/review-*.md",
        f"state/runs/{slug}/spec.md",
        "state/checkpoints/**/*.md",
        "state/plans/**/*.md",
    )


def digest(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def root_relative_matches(repo: Path, state: Path, pattern: str) -> set[str]:
    """Files a root-relative pattern names: `state/...` lives under `<state>`, anything else under `repo`."""
    in_state = pattern.startswith("state/")
    root = state if in_state else repo
    glob = pattern.removeprefix("state/")
    prefix = "state/" if in_state else ""
    return {
        prefix + path.relative_to(root).as_posix()
        for path in root.glob(glob)
        if path.is_file()
    }


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
    """Resolve the repository-relative spec path, refusing anything outside the repository."""
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


def resolve_state(state: Path, value: object, label: str, findings: list[str]) -> Path | None:
    """Resolve an absolute sandbox path under `<state>`, refusing anything outside it."""
    if not isinstance(value, str) or not value:
        findings.append(f"decision log meta does not name the {label}")
        return None
    path = decision_log.host_path(state, value)
    if path is None:
        findings.append(f"decision log meta {label} escapes the state root: {value}")
        return None
    if not path.is_file():
        findings.append(f"decision log meta {label} does not exist: {value}")
        return None
    return path

def artifact_name(repo: Path, state: Path, path: Path) -> str:
    """How a handoff cites an artifact: repository-relative in the repo, absolute under `<state>`."""
    if path.is_relative_to(state):
        return decision_log.sandbox_path(state, path)
    return path.relative_to(repo).as_posix()


def forbidden_advance(repo: Path, state: Path, topic: str | None, label: str, findings: list[str]) -> None:
    """Artifacts this run created or edited before it was entitled to.

    An amendment run starts from an existing `docs/specs/<topic>.md`; that page is
    a repository input, so only what changed since the baseline counts as advance.
    """
    if topic is None:
        return  # no readable log means no topic to scope these globs to
    def nul(*args: str) -> set[str]:
        # Paths may contain spaces; only NUL is a safe separator. `-z` is an option,
        # so it must precede `--` or Git reads it as a pathspec.
        out = subprocess.run(
            ["git", *args], cwd=repo, check=True, capture_output=True, text=True
        ).stdout
        return {name for name in out.split("\0") if name}

    try:
        fixture_root = subprocess.run(
            ["git", "rev-list", "--max-parents=0", "HEAD"],
            cwd=repo, check=True, capture_output=True, text=True,
        ).stdout.split()[0]
        baseline = nul("ls-tree", "-r", "-z", "--name-only", fixture_root)
        touched = nul("diff", "--name-only", "-z", fixture_root, "--")
    except (OSError, subprocess.CalledProcessError, IndexError):
        baseline, touched = set(), set()

    present = {
        name
        for pattern in forbidden_patterns(topic)
        for name in (root_relative_matches(repo, state, pattern))
    }
    # A deleted baseline artifact is a mutation of the same gated path.
    def gated(name: str) -> bool:
        for pattern in forbidden_patterns(topic):
            # `**/` means "any depth including none"; fnmatch needs both spellings.
            if fnmatch(name, pattern) or fnmatch(name, pattern.replace("**/", "")):
                return True
        return False

    candidates = present | {name for name in touched if gated(name)}
    matches = sorted(name for name in candidates if name not in baseline or name in touched)
    if matches:
        findings.append(f"{label} advanced past its gate: {matches}")


def check_source_boundary(repo: Path, state: Path, topic: str | None, findings: list[str]) -> None:
    allowed = writable(topic)
    if not (repo / ".git").is_dir():
        findings.append("trial repository has no frozen Git baseline")
        return

    def git_lines(*args: str) -> list[str]:
        result = subprocess.run(
            ["git", *args], cwd=repo, check=True, capture_output=True, text=True
        )
        return [line for line in result.stdout.splitlines() if line]

    # The fixture's root commit is the frozen baseline. A design run may add one
    # commit (the CMT commit that promotes the spec); anything else is history drift.
    root = git_lines("rev-list", "--max-parents=0", "HEAD")[0]
    commits = git_lines("rev-list", "--reverse", f"{root}..HEAD")
    if len(commits) > 1:
        findings.append(f"design trial changed commit history: {len(commits)} commits after the baseline")
    for commit in commits:
        for relative in git_lines("diff-tree", "--no-commit-id", "--name-only", "-r", commit):
            if relative not in {f"docs/specs/{topic}.md", "GLOSSARY.md"}:
                findings.append(f"CMT commit touches a non-design path: {relative}")

    for relative in git_lines("diff", "--name-only", root, "--"):
        if not any(pattern.fullmatch(relative) for pattern in allowed):
            findings.append(f"source input modified: {relative}")

    # Repository state is never a `.wayne/` directory, however created: it is
    # gitignored, untracked, or committed, and each of those is a finding.
    if (repo / ".wayne").exists():
        findings.append("repository contains a .wayne/ directory")

    # Enumerate ignored paths too: an agent could otherwise hide a stray artifact
    # behind a gitignore entry.
    untracked = sorted(
        set(git_lines("ls-files", "--others", "--exclude-standard"))
        | {line for line in git_lines("ls-files", "--others", "--ignored", "--exclude-standard")
           if not line.startswith(".git/")}
    )
    for relative in untracked:
        if "__pycache__" in Path(relative).parts or relative.endswith((".pyc", ".pyo")):
            continue
        if not any(pattern.fullmatch(relative) for pattern in allowed):
            findings.append(f"unexpected file outside design outputs: {relative}")

    state_files = (
        sorted(path.relative_to(state).as_posix() for path in state.rglob("*") if path.is_file())
        if state.is_dir()
        else []
    )
    state_allowed = writable_state(topic)
    for relative in state_files:
        if not any(pattern.fullmatch(relative) for pattern in state_allowed):
            findings.append(f"unexpected state file outside design outputs: {relative}")
    plans = [name for name in state_files if name.startswith("plans/")]
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


def topic_of(log: "decision_log.Log | None") -> str | None:
    """The run directory names the topic; `meta.topic` is checked against it."""
    if log is None:
        return None
    return log.topic_dir.name or None


def validate_complete(repo: Path, state: Path, case: str, output: str) -> list[str]:
    findings: list[str] = []
    log = decision_log.read(repo, state, findings)
    check_source_boundary(repo, state, topic_of(log), findings)
    handoff = exactly_one(state, "checkpoints/*.md", "handoff packet", findings)

    spec: Path | None = None
    matrix: Path | None = None
    report_digests: dict[str, str] = {}
    if log is not None:
        if str(log.meta.get("status", "")) != "design-approved":
            findings.append(f"decision log meta.status={log.meta.get('status')!r}, expected 'design-approved'")
        spec = resolve(repo, log.meta.get("spec"), "spec", findings)
        matrix = resolve_state(state, log.meta.get("test_matrix"), "test matrix", findings)
        if spec is not None and not LIVING_SPEC.fullmatch(log.meta["spec"]):
            findings.append(f"approved spec is not a living page: {log.meta['spec']}")
        if spec is not None and log.meta.get("approved_spec_sha256") != digest(spec):
            findings.append("the promoted spec is not the revision the user approved")

        unresolved = sorted(
            identifier
            for identifier, record in log.nodes.items()
            if str(record.get("status", "")).casefold() not in {"resolved", "not-applicable"}
        )
        if unresolved:
            findings.append(f"converged with an unresolved frontier: {unresolved}")

        if (log.topic_dir / "spec.md").is_file():
            findings.append("candidate spec survived promotion: the run copied instead of moving")

        review_decisions = [
            record for record in log.decisions
            if str(record.get("source", "")).casefold() == "review"
        ]
        for role in ("product", "engineering"):
            report = log.topic_dir / f"review-{role}.md"
            relative = decision_log.sandbox_path(state, report)
            if not report.is_file():
                findings.append(f"missing final {role} review report")
            else:
                text = report.read_text(encoding="utf-8")
                roles = re.findall(r"^ROLE:\s*(\S+)\s*$", text, re.MULTILINE)
                verdicts = re.findall(r"^VERDICT:\s*(\S+)\s*$", text, re.MULTILINE)
                digests = re.findall(r"^SHA256:\s*([0-9a-f]{64})\s*$", text, re.MULTILINE)
                if roles != [role]:
                    findings.append(f"{role} review report names roles {roles}")
                if verdicts != ["PASS"]:
                    findings.append(f"final {role} review verdicts {verdicts}, expected ['PASS']")
                if len(digests) != 1:
                    findings.append(f"{role} review report names {len(digests)} reviewed digests")
                else:
                    report_digests[role] = digests[0]
            outcomes = [
                record for record in review_decisions
                if str(record.get("reference") or "") == relative
            ]
            rounds = [e.get("verdict") for e in read_events(repo, []) if e.get("role") == role]
            logged = []
            for record in outcomes:
                stated = str(record.get("decision", ""))
                verdict = re.match(r"(PASS|REVISE)\b", stated)
                if not verdict:
                    findings.append(f"logged {role} review outcome states no verdict: {stated[:40]!r}")
                logged.append(verdict.group(1) if verdict else stated[:16])
            if rounds and logged != rounds:
                findings.append(f"{role} executions returned {rounds} but the log records {logged}")
            if not outcomes:
                findings.append(f"decision log holds no {role} review outcome")
            elif logged[-1] != "PASS":
                findings.append(f"the last logged {role} review outcome is not a PASS")

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
        blocks = re.split(r"(?m)^(?=###\s+R[1-9]\d*\s)", requirement_section)[1:]
        for block in blocks:
            name = re.match(r"###\s+(R[1-9]\d*)\s", block).group(1)
            for field in ("Current", "Target", "Acceptance"):
                seen = len(re.findall(rf"^-\s+\*\*{field}\*\*\s+—\s+\S", block, re.MULTILINE))
                if seen != 1:
                    findings.append(f"{name} carries {seen} {field} lines")
        for requirement in requirements:
            proofs = re.findall(rf"^\|\s*{requirement}\s*\|", verification_section, re.MULTILINE)
            if len(proofs) != 1:
                findings.append(f"{requirement} has {len(proofs)} verification proofs")
        frontmatter = re.match(r"---\n(.*?)\n---\n", spec_text, re.DOTALL)
        header = frontmatter.group(1) if frontmatter else ""
        if not frontmatter:
            findings.append("spec has no frontmatter")
        statuses = re.findall(r"^status:\s*(\S+)\s*$", header, re.MULTILINE)
        if statuses != ["stable"]:
            findings.append(f"approved living spec status={statuses}, expected ['stable']")
        generated_at = re.search(r"^generated:.*\bat:\s*([^\s}]+)", header, re.MULTILINE)
        confirmations = re.findall(r"\bat:\s*([0-9T:\-]+Z?)", re.sub(r"^generated:.*$", "", header, flags=re.MULTILINE))
        if generated_at and any(at >= generated_at.group(1) for at in confirmations):
            findings.append("design stage wrote a `verified` entry owned by wayne-verify")
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
        if final_spec_digest and report_digests.get(role) != final_spec_digest:
            findings.append(f"{role} review report does not name the final spec digest")

    artifacts = [path for path in (log.path if log else None, spec, matrix) if path]
    names = [artifact_name(repo, state, path) for path in artifacts]
    if handoff:
        handoff_text = handoff.read_text(encoding="utf-8")
        for needle in ("status: design-approved", "next_agent: wayne-plan"):
            if needle not in handoff_text:
                findings.append(f"handoff missing {needle!r}")
        for name in names:
            if name not in handoff_text:
                findings.append(f"handoff omits {name}")

    if "wayne-plan" not in output:
        findings.append("user-visible handoff does not name wayne-plan")
    for name in names:
        if name not in output:
            findings.append(f"user-visible handoff omits {name}")
    return findings


def validate_conflict(repo: Path, state: Path, output: str) -> list[str]:
    findings: list[str] = []
    log = decision_log.read(repo, state, findings)
    check_source_boundary(repo, state, topic_of(log), findings)
    if log is not None and str(log.meta.get("status", "")) == "design-approved":
        findings.append("conflict case marked its decision log design-approved")
    forbidden_advance(repo, state, topic_of(log), "conflict case", findings)
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


def validate_decision_locked(repo: Path, state: Path, output: str) -> list[str]:
    findings: list[str] = []
    log = decision_log.read(repo, state, findings)
    check_source_boundary(repo, state, topic_of(log), findings)
    if log is not None:
        if str(log.meta.get("status", "")) == "design-approved":
            findings.append("locked frontier was promoted to design-approved")
        if not log.meta.get("frontier_locked"):
            findings.append("the user's frontier lock was dropped")
        if log.meta.get("written_spec_approved"):
            findings.append("unapproved design sections were marked approved")
        unresolved = sorted(
            identifier
            for identifier, record in log.nodes.items()
            if str(record.get("status", "")).casefold() not in {"resolved", "not-applicable"}
        )
        if unresolved:
            findings.append(f"decision lock reopened nodes: {unresolved}")

    forbidden_advance(repo, state, topic_of(log), "decision lock", findings)

    question_marks = output.count("?") + output.count("？")
    if question_marks != 1:
        findings.append(f"decision-lock response must ask exactly one question; found={question_marks}")
    if not RECOMMENDATION.search(output):
        findings.append("decision-lock response lacks a recommendation")
    if not re.search(r"design|architecture|section|设计|架构|章节|批准|确认", output, re.IGNORECASE):
        findings.append("decision-lock response did not route to design approval")
    return findings


def validate_depth_recommendation(repo: Path, state: Path, output: str) -> list[str]:
    findings: list[str] = []
    log = decision_log.read(repo, state, findings)
    check_source_boundary(repo, state, topic_of(log), findings)
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

    forbidden_advance(repo, state, topic_of(log), "depth case", findings)

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
    state = decision_log.state_root(workspace).resolve()
    if not repo.is_dir():
        return [f"missing trial repository: {repo}"]
    try:
        output = load_output(output_path)
    except (OSError, json.JSONDecodeError) as error:
        return [f"no readable agent result: {type(error).__name__}"]
    if not output:
        return ["agent produced no user-visible output"]
    if case in COMPLETE_CASES:
        findings = validate_complete(repo, state, case, output)
        if trace_path is not None:
            findings.extend(validate_trace(trace_path, provider))
        return findings
    if case == "conflict":
        return validate_conflict(repo, state, output)
    if case == "decision-locked":
        return validate_decision_locked(repo, state, output)
    if case == "depth-recommendation":
        return validate_depth_recommendation(repo, state, output)
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
