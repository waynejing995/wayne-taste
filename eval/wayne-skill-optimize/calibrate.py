#!/usr/bin/env python3
"""Calibrate intent, temporal, and dependency-capability invariants."""

from __future__ import annotations

import json
import shutil
import subprocess
import tempfile
from pathlib import Path

from check_trial import validate


COVERAGE = """# Behavior coverage
Sources: git initial commit {commit}; usage-feedback.md; policy.md; current skill.

| ID | Original intent | Oracle |
|---|---|---|
| I1 | Ask exactly one question and wait | interview-and-handoff |
| I2 | Persist each answer immediately before asking the next | temporal-persistence |
| I3 | Founder product review with a self-contained replacement | review-types |
| I4 | Engineering review with a self-contained replacement | review-types |
| I5 | Return planner handoff; no auto advance, manual trigger | interview-and-handoff |
"""
TEMPORAL = """Three answers: answer 1, answer 2, answer 3.
The feed must refuse before answer 2 unless answer 1 is durable, and likewise before the next answer.
Oracle: append-only write-event log plus decision-log hash sequence after every answer.
The final file alone is not enough to prove timing.
"""
REVIEWS = """Run independent founder/product and engineering voices against the same spec SHA256 bytes.
Founder challenges premise/scope/value; engineering challenges architecture/failure/tests/performance.
Any REVISE changes the spec and requires rerun. Missing either voice is BLOCKED and must fail loud.
The forbidden addon is replaced by this self-contained type contract; oracle: forbidden_addon_absent.
"""
INTERVIEW = """Ask exactly one question and wait. Return only the planner handoff; manual trigger, no auto advance.
"""


def write(path: Path, text: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding="utf-8")


def seed(root: Path) -> tuple[Path, Path]:
    repo = root / "repo"
    (repo / "decision-builder").mkdir(parents=True)
    write(repo / "decision-builder/SKILL.md", "current\n")
    write(repo / "policy.md", "policy\n")
    write(repo / "usage-feedback.md", "feedback\n")
    subprocess.run(["git", "init", "-q"], cwd=repo, check=True)
    subprocess.run(["git", "config", "user.name", "Eval"], cwd=repo, check=True)
    subprocess.run(["git", "config", "user.email", "eval@example.invalid"], cwd=repo, check=True)
    subprocess.run(["git", "add", "."], cwd=repo, check=True)
    subprocess.run(["git", "commit", "-q", "-m", "fixture"], cwd=repo, check=True)
    commit = subprocess.run(["git", "rev-parse", "HEAD"], cwd=repo, check=True, capture_output=True, text=True).stdout.strip()
    write(repo / ".eval/initial-commit", commit + "\n")
    dossier = repo / "eval/decision-builder"
    write(dossier / "behavior-coverage.md", COVERAGE.format(commit=commit))
    write(dossier / "cases/temporal-persistence.md", TEMPORAL)
    write(dossier / "cases/review-types.md", REVIEWS)
    write(dossier / "cases/interview-and-handoff.md", INTERVIEW)
    output = root / "output.txt"
    write(output, json.dumps({"result": "Intent recovered; harness frozen."}))
    return output, dossier


def expect(root: Path, output: Path, needle: str) -> None:
    findings = validate(root, output)
    if not any(needle in finding for finding in findings):
        raise AssertionError(f"mutation missed {needle!r}: {findings}")


def main() -> int:
    with tempfile.TemporaryDirectory(prefix="skill-optimize-calibration-") as temp:
        root = Path(temp)
        output, dossier = seed(root)
        findings = validate(root, output)
        if findings:
            raise AssertionError(f"positive fixture failed: {findings}")

        coverage_path = dossier / "behavior-coverage.md"
        for alternate_name in ("intent-coverage-matrix.md", "INTENT.md", "invariants.md"):
            alternate_path = dossier / alternate_name
            coverage_path.rename(alternate_path)
            findings = validate(root, output)
            if findings:
                raise AssertionError(f"alternate coverage filename {alternate_name} failed: {findings}")
            alternate_path.rename(coverage_path)

        mutations = (
            ("feedback", "usage-feedback.md", "feedback"),
            ("question", "| I1 | Ask exactly one question and wait | interview-and-handoff |", "one-question"),
            ("timing", "| I2 | Persist each answer immediately before asking the next | temporal-persistence |", "per-answer persistence"),
            ("founder", "Founder product review", "founder/product"),
            ("engineering", "Engineering review", "engineering review"),
            ("handoff", "| I5 | Return planner handoff; no auto advance, manual trigger | interview-and-handoff |", "no-auto-advance"),
            ("replacement", "self-contained replacement", "capability replacement"),
        )
        original = (dossier / "behavior-coverage.md").read_text(encoding="utf-8")
        write(coverage_path, original + "\nNo row may be UNVERIFIED before candidate generation.\n")
        findings = validate(root, output)
        if findings:
            raise AssertionError(f"UNVERIFIED prose caused a false positive: {findings}")
        write(coverage_path, original)
        for _, token, finding in mutations:
            write(dossier / "behavior-coverage.md", original.replace(token, "REMOVED"))
            expect(root, output, finding)
        write(dossier / "behavior-coverage.md", original + "\n| I6 | Missing behavior | UNVERIFIED |\n")
        expect(root, output, "UNVERIFIED")
        write(dossier / "behavior-coverage.md", original)

        cases = (
            (
                "temporal-persistence.md",
                "Oracle: append-only write-event log plus decision-log hash sequence after every answer.",
                "write-event oracle",
            ),
            (
                "temporal-persistence.md",
                "The feed must refuse before answer 2 unless answer 1 is durable, and likewise before the next answer.",
                "next-answer gate",
            ),
            (
                "temporal-persistence.md",
                "The final file alone is not enough to prove timing.",
                "final-state insufficiency",
            ),
            ("review-types.md", "independent", "independent voices"),
            ("review-types.md", "same spec SHA256 bytes", "same spec bytes"),
            ("review-types.md", "Any REVISE changes the spec and requires rerun.", "revise and rerun"),
            ("review-types.md", "Missing either voice is BLOCKED and must fail loud.", "fail-loud"),
        )
        for filename, token, finding in cases:
            path = dossier / "cases" / filename
            text = path.read_text(encoding="utf-8")
            write(path, text.replace(token, "REMOVED"))
            expect(root, output, finding)
            write(path, text)

        (dossier / "candidate").mkdir()
        expect(root, output, "candidate was generated")
        (dossier / "candidate").rmdir()
        (dossier / "control-results").mkdir()
        expect(root, output, "nested model trials")
        print("PASS: calibrated positive dossier and 17 independent mutations")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
