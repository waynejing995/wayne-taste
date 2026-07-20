#!/usr/bin/env python3
"""Validate checkpoint templates against the single-owner artifact contract."""

from __future__ import annotations

import argparse
import tempfile
from pathlib import Path


def validate(skill: Path) -> list[str]:
    checkpoint = (skill / "templates/checkpoint-template.md").read_text(encoding="utf-8")
    handoff = (skill / "templates/handoff-packet.md").read_text(encoding="utf-8")
    main = (skill / "SKILL.md").read_text(encoding="utf-8")
    findings: list[str] = []

    checkpoint_headings = {
        line.strip() for line in checkpoint.splitlines() if line.startswith("### ")
    }
    required_checkpoint = {
        "### Artifact References",
        "### Decision Progress",
        "### Implementation Progress",
    }
    missing = sorted(required_checkpoint - checkpoint_headings)
    if missing:
        findings.append(f"checkpoint template missing ownership sections: {missing}")
    for legacy in ("### Decision Log Snapshot", "### Implementation Units (from plan)"):
        if legacy in checkpoint_headings:
            findings.append(f"checkpoint template restores copied owner: {legacy}")

    required_table = "| Artifact | Path | Owner | SHA-256 | Observed state |"
    if required_table not in checkpoint or required_table not in handoff:
        findings.append("templates require one Path/Owner/SHA-256 reference table")
    if "test_matrix:" not in checkpoint.split("---", 2)[1]:
        findings.append("checkpoint frontmatter omits test_matrix")
    if "### Artifact References" not in handoff:
        findings.append("handoff template omits Artifact References")
    for legacy in (
        "Implementation Units (checkbox status copied from plan)",
        "Decision Log Snapshot (table copied from decision log)",
    ):
        if legacy in handoff:
            findings.append(f"handoff template restores copied owner: {legacy}")
    if "test_matrix`" not in main and "`test_matrix`" not in main:
        findings.append("SKILL required frontmatter omits test_matrix")
    return findings


def calibrate(skill: Path) -> list[str]:
    findings = validate(skill)
    if findings:
        return [f"valid templates failed: {findings}"]
    mutations = {
        "decision-copy": ("templates/checkpoint-template.md", "### Decision Progress", "### Decision Log Snapshot"),
        "unit-copy": ("templates/checkpoint-template.md", "### Implementation Progress", "### Implementation Units (from plan)"),
        "missing-owner-table": ("templates/handoff-packet.md", "| Artifact | Path | Owner | SHA-256 | Observed state |", "| Artifact | Path | Observed state |"),
        "missing-test-matrix": ("templates/checkpoint-template.md", "test_matrix: docs/test-matrix/{file}.md\n", ""),
    }
    with tempfile.TemporaryDirectory(prefix="checkpoint-template-calibration-") as temp:
        root = Path(temp) / "skill"
        for source in skill.rglob("*"):
            if source.is_file() and "__pycache__" not in source.parts:
                target = root / source.relative_to(skill)
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_bytes(source.read_bytes())
        for label, (relative, old, new) in mutations.items():
            candidate = root / relative
            original = candidate.read_text(encoding="utf-8")
            candidate.write_text(original.replace(old, new), encoding="utf-8")
            if not validate(root):
                findings.append(f"{label} mutation escaped")
            candidate.write_text(original, encoding="utf-8")
    return findings


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("skill", type=Path)
    parser.add_argument("--calibrate", action="store_true")
    args = parser.parse_args()
    findings = calibrate(args.skill) if args.calibrate else validate(args.skill)
    if findings:
        for finding in findings:
            print(f"FAIL: {finding}")
        return 1
    print("PASS: checkpoint template ownership" + (" and 4 mutations" if args.calibrate else ""))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
