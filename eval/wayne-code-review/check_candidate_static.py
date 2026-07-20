#!/usr/bin/env python3
"""Static contract checker for a Wayne Code Review candidate directory."""

from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path


REQUIRED_NAME = "wayne-code-review"
REQUIRED_RESOURCES = (
    "scripts/run_dual_review.py",
    "references/review-playbooks.md",
)
REVIEW_TYPES = (
    "security",
    "dataflow",
    "architecture",
    "concurrency",
    "performance",
    "tests",
    "api-migration",
)
PLAYBOOK_CONTRACTS = {
    "planned-missing direction": "planned behavior missing from the diff",
    "diff-unplanned direction": "unplanned behavior added by it",
    "orphan producer class": "orphan producer",
    "dead consumer class": "dead consumer",
    "semantic drift class": "semantic drift",
    "dual path class": "dual path",
    "half migration class": "half migration",
    "wrong-value severity": "critical when a real consumer receives a wrong value",
    "dead-surface severity": "informational for proven orphan/dead surface",
    "architecture trigger": "ownership, module boundaries, lifecycle, persistent state",
    "architecture owner": "single owner for each state",
    "architecture decline": "small pure function or local bug fix",
}
FORBIDDEN_DEPENDENCIES = ("gstack",)
IGNORED_PARTS = {".git", "__pycache__", ".pytest_cache", ".ruff_cache"}
RUNNER_INTENT_CONTRACT = (
    "--intent-source",
    "--intent-summary-file",
    "CALLER INTENT PACKET BEGIN",
)


def parse_skill(path: Path) -> tuple[dict[str, str], str, list[str]]:
    findings: list[str] = []
    if not path.is_file():
        return {}, "", ["missing SKILL.md"]

    text = path.read_text(encoding="utf-8")
    lines = text.splitlines()
    if not lines or lines[0].strip() != "---":
        return {}, "", ["SKILL.md must start with YAML frontmatter"]

    try:
        end = next(index for index in range(1, len(lines)) if lines[index].strip() == "---")
    except StopIteration:
        return {}, "", ["SKILL.md frontmatter has no closing delimiter"]

    frontmatter: dict[str, str] = {}
    for line in lines[1:end]:
        if not line or line[0].isspace() or line.lstrip().startswith("#"):
            continue
        match = re.match(r"^([A-Za-z][A-Za-z0-9_-]*):\s*(.*)$", line)
        if not match:
            findings.append(f"invalid frontmatter line: {line!r}")
            continue
        key, value = match.groups()
        if key in frontmatter:
            findings.append(f"duplicate frontmatter key: {key}")
        frontmatter[key] = value.strip().strip("\"'")

    if set(frontmatter) != {"name", "description"}:
        findings.append(
            "frontmatter keys must be exactly name and description; "
            f"found={sorted(frontmatter)}"
        )
    if frontmatter.get("name") != REQUIRED_NAME:
        findings.append(
            f"frontmatter name must be {REQUIRED_NAME!r}; found={frontmatter.get('name')!r}"
        )
    if not frontmatter.get("description"):
        findings.append("frontmatter description must be non-empty")

    body = "\n".join(lines[end + 1 :]).strip()
    if not body:
        findings.append("SKILL.md body is empty")
    return frontmatter, body, findings


def text_files(root: Path) -> list[tuple[Path, str]]:
    result: list[tuple[Path, str]] = []
    for path in sorted(root.rglob("*")):
        if not path.is_file() or any(part in IGNORED_PARTS for part in path.parts):
            continue
        try:
            text = path.read_text(encoding="utf-8")
        except (UnicodeDecodeError, OSError):
            continue
        result.append((path, text))
    return result


def has_any(text: str, patterns: tuple[str, ...], *, flags: int = re.IGNORECASE) -> bool:
    return any(re.search(pattern, text, flags) for pattern in patterns)


def check_candidate(root: Path) -> list[str]:
    findings: list[str] = []
    if not root.is_dir():
        return [f"candidate is not a directory: {root}"]

    _, body, skill_findings = parse_skill(root / "SKILL.md")
    findings.extend(skill_findings)
    body_lower = body.lower()

    for relative in REQUIRED_RESOURCES:
        if relative not in body:
            findings.append(f"SKILL.md body does not reference {relative}")
        resource = root / relative
        if not resource.is_file():
            findings.append(f"missing required resource: {relative}")
        elif resource.is_symlink():
            findings.append(f"required resource must be self-contained, not a symlink: {relative}")
        elif not resource.read_text(encoding="utf-8").strip():
            findings.append(f"required resource is empty: {relative}")

    playbook_path = root / "references/review-playbooks.md"
    playbooks = playbook_path.read_text(encoding="utf-8") if playbook_path.is_file() else ""
    normalized_playbooks = re.sub(
        r"\s+", " ", playbooks.lower().replace("_", "-").replace("`", "")
    )
    for review_type in REVIEW_TYPES:
        pattern = rf"(?<![a-z0-9]){re.escape(review_type).replace(r'\-', '[- ]')}(?![a-z0-9])"
        if not re.search(pattern, normalized_playbooks):
            findings.append(f"review playbooks omit required review type: {review_type}")
    for label, phrase in PLAYBOOK_CONTRACTS.items():
        if phrase not in normalized_playbooks:
            findings.append(f"review playbooks omit {label}: {phrase}")

    runner_path = root / "scripts/run_dual_review.py"
    runner = runner_path.read_text(encoding="utf-8") if runner_path.is_file() else ""
    for identity in ("claude", "codex"):
        if identity not in runner.lower():
            findings.append(f"dual-review runner omits {identity} adapter identity")
    for literal in RUNNER_INTENT_CONTRACT:
        if literal not in runner:
            findings.append(f"dual-review runner omits intent contract: {literal}")

    if "claude" not in body_lower or "codex" not in body_lower:
        findings.append("SKILL.md must require both Claude and Codex voices")
    if not has_any(
        body,
        (
            r"\bexactly\s+two\b[^.\n]{0,80}\b(?:voices?|reviewers?)\b",
            r"\b(?:two|2)\s+exact\b[^.\n]{0,80}\b(?:voices?|reviewers?)\b",
            r"\b(?:voices?|reviewers?)\b[^.\n]{0,80}\bexactly\s+(?:two|2)\b",
        ),
    ):
        findings.append("SKILL.md must require exactly two review voices")

    if not all(token in body_lower for token in ("same", "frozen", "hash")):
        findings.append("SKILL.md must require both voices to use the same frozen hash")
    if not has_any(body, (r"\bparallel\b", r"\bconcurrent(?:ly)?\b", r"both\s+start[^.]{0,80}before")):
        findings.append("SKILL.md must require parallel reviewer execution")

    failure_terms = (r"\bfail(?:ed|ure|s)?\b", r"\binvalid\b", r"\bunavailable\b", r"\btimeout\b")
    non_pass_terms = (
        r"\bnot\s+(?:a\s+)?pass\b",
        r"\bmust\s+not\s+pass\b",
        r"\bcannot\s+pass\b",
        r"\bnon[- ]pass\b",
        r"\bnever\s+pass\b",
    )
    if not has_any(body, failure_terms) or not has_any(body, non_pass_terms):
        findings.append("SKILL.md must state that either voice failing cannot produce PASS")

    if not has_any(body, (r"\breview[- ]only\b",)):
        findings.append("SKILL.md must declare review-only behavior")
    if not has_any(
        body,
        (
            r"\bno\s+auto[- ]fix\b",
            r"\bnever\s+auto[- ]fix\b",
            r"\bdo\s+not\s+auto[- ]fix\b",
            r"\bmust\s+not\s+auto[- ]fix\b",
        ),
    ):
        findings.append("SKILL.md must forbid automatic fixes")
    if not has_any(body, (r"\bstatic[- ]only\b",)):
        findings.append("SKILL.md must declare static-only review")

    handoff_ok = False
    for paragraph in re.split(r"\n\s*\n", body_lower):
        normalized = re.sub(r"\s+", " ", paragraph)
        required = ("only", "clean", "pass", "return-only", "wayne-verify")
        if all(token in normalized for token in required):
            handoff_ok = True
            break
    if not handoff_ok:
        findings.append(
            "SKILL.md must allow a return-only wayne-verify handoff only for a clean PASS"
        )

    normative_docs = [(root / "SKILL.md", body)]
    references = root / "references"
    if references.is_dir():
        normative_docs.extend(
            (path, path.read_text(encoding="utf-8"))
            for path in sorted(references.rglob("*.md"))
            if path.is_file()
        )
    normative_forbidden = (
        (re.compile(r"~/\.claude(?:/|\b)", re.IGNORECASE), "Claude home path"),
        (re.compile(r"\bsubagent_type\b", re.IGNORECASE), "subagent_type"),
        (re.compile(r"\bcodex\s+exec\b", re.IGNORECASE), "codex exec"),
        (re.compile(r"\bAgent\s*(?:\(|tool\b)"), "Agent tool"),
    )
    for path, text in normative_docs:
        relative = path.relative_to(root)
        for pattern, label in normative_forbidden:
            if pattern.search(text):
                findings.append(f"normative document hard-codes {label}: {relative}")

    for path, text in text_files(root):
        lower = text.lower()
        for dependency in FORBIDDEN_DEPENDENCIES:
            if dependency in lower:
                findings.append(
                    "candidate references forbidden dependency "
                    f"{dependency!r}: {path.relative_to(root)}"
                )

    return findings


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Validate the static contract of a Wayne Code Review candidate."
    )
    parser.add_argument("candidate", type=Path, help="candidate skill directory")
    args = parser.parse_args()

    findings = check_candidate(args.candidate.resolve())
    if findings:
        for finding in findings:
            print(f"FAIL: {finding}")
        return 1
    print("PASS: wayne-code-review candidate static contract")
    return 0


if __name__ == "__main__":
    sys.exit(main())
