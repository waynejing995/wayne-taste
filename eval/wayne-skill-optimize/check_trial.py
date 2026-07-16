#!/usr/bin/env python3
"""Frozen checker for original-intent recovery by Wayne Skill Optimize."""

from __future__ import annotations

import argparse
import json
import re
import subprocess
from pathlib import Path


def load_output(path: Path) -> str:
    text = path.read_text(encoding="utf-8")
    try:
        data = json.loads(text)
    except json.JSONDecodeError:
        return text.strip()
    if isinstance(data, dict) and isinstance(data.get("result"), str):
        return data["result"].strip()
    return text.strip()


def require(text: str, findings: list[str], label: str, choices: tuple[str, ...]) -> None:
    lowered = text.casefold()
    if not any(choice.casefold() in lowered for choice in choices):
        findings.append(f"missing {label}: expected one of {choices!r}")


def dossier_text(dossier: Path, names: tuple[str, ...] = ()) -> str:
    parts: list[str] = []
    for path in sorted(dossier.rglob("*")):
        if not path.is_file() or path.suffix not in {".md", ".py", ".json", ".jsonl"}:
            continue
        if names and not any(name in path.name.casefold() for name in names):
            continue
        parts.append(path.read_text(encoding="utf-8"))
    return "\n".join(parts)


def validate(workspace: Path, output_path: Path) -> list[str]:
    findings: list[str] = []
    repo = workspace / "repo"
    dossier = repo / "eval/decision-builder"
    coverage_candidates = (
        dossier / "behavior-coverage.md",
        dossier / "original-intent.md",
        dossier / "intent.md",
        dossier / "intent-coverage-matrix.md",
    )
    coverage_paths = {path for path in coverage_candidates if path.is_file()}
    for path in dossier.glob("*.md"):
        name = path.name.casefold()
        if not path.is_file():
            continue
        content = path.read_text(encoding="utf-8")
        lowered = content.casefold()
        semantic_ledger = (
            "|" in content
            and "source" in lowered
            and any(token in lowered for token in ("oracle", "observable invariant", "behavior"))
        )
        if any(token in name for token in ("intent", "coverage", "matrix")) or semantic_ledger:
            coverage_paths.add(path)
    coverage_text = "\n".join(
        path.read_text(encoding="utf-8") for path in sorted(coverage_paths)
    )
    if not coverage_text:
        return ["missing original-intent coverage artifact"]
    initial_hash = (repo / ".eval/initial-commit").read_text(encoding="utf-8").strip()
    if not any(initial_hash[:length] in coverage_text for length in (40, 12, 7)):
        findings.append("coverage does not cite the initial design commit")
    for source in ("usage-feedback.md", "policy.md"):
        if source.casefold() not in coverage_text.casefold():
            findings.append(f"coverage omits source {source}")
    require(
        coverage_text,
        findings,
        "git history source",
        ("git", "commit ", "initial commit", "creation commit", ".eval/initial-commit"),
    )
    if re.search(r"\|\s*UNVERIFIED\s*\|", coverage_text, flags=re.IGNORECASE):
        findings.append("coverage contains UNVERIFIED intent")

    require(
        coverage_text,
        findings,
        "one-question wait intent",
        ("one question", "exactly one", "one unanswered question", "一问"),
    )
    require(coverage_text, findings, "per-answer persistence intent", ("before the next", "before asking", "每次", "immediate"))
    require(coverage_text, findings, "founder/product review intent", ("founder", "product"))
    require(coverage_text, findings, "engineering review intent", ("engineering", "eng manager"))
    require(coverage_text, findings, "planner handoff intent", ("planner", "planning"))
    require(coverage_text, findings, "no-auto-advance intent", ("no auto", "never auto", "manual trigger", "不自动"))
    lowered_coverage = coverage_text.casefold()
    if not ("distinct founder" in lowered_coverage and "distinct engineering" in lowered_coverage):
        require(
            coverage_text,
            findings,
            "forbidden capability replacement",
            (
                "replacement",
                "self-contained",
                "capabilities/roles",
                "capabilities must remain",
                "review capabilities",
                "removes a mechanism",
                "替代",
            ),
        )

    temporal_text = dossier_text(dossier)
    if temporal_text.casefold().count('"type": "answer_recorded"') < 2:
        require(
            temporal_text,
            findings,
            "multiple staged answers",
            (
                "answer 2",
                "second_question",
                "expected_decision_ids",
                "two answers",
                "three answers",
                '"id": "q2"',
                '"question_id": "q2"',
                '"qid": "q2"',
                '"decision_id": "d2"',
                "第二",
            ),
        )
    require(
        temporal_text,
        findings,
        "write-event oracle",
        (
            "write event",
            "write-event",
            "hash sequence",
            "event log",
            "log_append",
            "decision_appended",
            "decision_write",
            "durable_write",
            "decision_persisted",
            "append_each_before",
            "写入事件",
        ),
    )
    require(
        temporal_text,
        findings,
        "next-answer gate",
        (
            "refuse",
            "before answer 2",
            "before the next answer",
            "before the next question",
            "question asked while",
            "next boundary",
            "append_each_before_boundary",
            "拒绝",
        ),
    )
    require(
        temporal_text,
        findings,
        "final-state insufficiency",
        (
            "final file",
            "final artifact",
            "not enough",
            "not an end-of-session",
            "end-of-conversation",
            "only at end",
            "only at the end",
            "never reconstructed at the end",
            "never reconstructed at end",
            "append_each_before_boundary",
            "不足",
        ),
    )

    reviews_text = dossier_text(dossier)
    require(reviews_text, findings, "founder review type", ("founder", "product"))
    require(reviews_text, findings, "engineering review type", ("engineering", "eng manager"))
    require(reviews_text, findings, "independent voices", ("independent", "different model", "独立"))
    require(reviews_text, findings, "same spec bytes", ("same spec", "same bytes", "sha256", "相同"))
    require(reviews_text, findings, "revise and rerun", ("revise", "rerun", "重跑"))
    require(reviews_text, findings, "fail-loud reviewer loss", ("fail loud", "blocked", "visible", "不得降级", "阻断"))
    require(
        reviews_text,
        findings,
        "forbidden dependency absence oracle",
        (
            "forbidden_addon_absent",
            "inv-no-addon",
            "must not invoke",
            "forbidden dependency",
            "禁止依赖",
        ),
    )

    interview_text = dossier_text(dossier)
    require(interview_text, findings, "one-question wait case", ("one question", "exactly one", "一问"))
    require(
        interview_text,
        findings,
        "manual handoff case",
        (
            "no auto",
            "never auto",
            "manual",
            "return only",
            "no_planning",
            "planner_not_run",
            "without planner execution",
            "不自动",
        ),
    )

    if (dossier / "candidate").exists() or any(dossier.glob("candidate*")):
        findings.append("candidate was generated before intent coverage acceptance")
    if (dossier / "control-results").exists():
        findings.append("meta-eval launched nested model trials")
    diff = subprocess.run(
        ["git", "diff", "--exit-code", "--", "decision-builder/SKILL.md"],
        cwd=repo,
        capture_output=True,
        text=True,
    )
    if diff.returncode != 0:
        findings.append("live target skill was edited during dossier-only phase")
    if not load_output(output_path):
        findings.append("agent produced no user-visible summary")
    return findings


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("workspace", type=Path)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    findings = validate(args.workspace.resolve(), args.output.resolve())
    if findings:
        for finding in findings:
            print(f"FAIL: {finding}")
        return 1
    print("PASS: complete original-intent dossier")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
