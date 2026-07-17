#!/usr/bin/env python3
"""Calibrate the candidate static checker with one mutation per contract family."""

from __future__ import annotations

import argparse
import re
import shutil
import tempfile
from pathlib import Path

from check_candidate_static import PLAYBOOK_CONTRACTS, REVIEW_TYPES, check_candidate


def replace(path: Path, pattern: str, value: str, flags: int = 0) -> None:
    text = path.read_text(encoding="utf-8")
    changed, count = re.subn(pattern, value, text, flags=flags)
    if count == 0:
        raise AssertionError(f"mutation pattern did not match: {pattern!r} in {path}")
    path.write_text(changed, encoding="utf-8")


def assert_invalid(root: Path, needle: str, label: str) -> None:
    findings = check_candidate(root)
    if not any(needle in finding for finding in findings):
        raise AssertionError(f"{label} missing {needle!r}: {findings}")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("candidate", type=Path)
    args = parser.parse_args()
    candidate = args.candidate.resolve()
    findings = check_candidate(candidate)
    if findings:
        raise AssertionError(f"positive candidate failed: {findings}")

    with tempfile.TemporaryDirectory(prefix="wayne-review-static-") as temp:
        root = Path(temp)
        count = 0

        def clone(name: str) -> Path:
            nonlocal count
            count += 1
            target = root / name
            shutil.copytree(candidate, target)
            return target

        trial = clone("missing-runner")
        (trial / "scripts/run_dual_review.py").unlink()
        assert_invalid(trial, "missing required resource", "missing runner")

        trial = clone("missing-playbooks")
        (trial / "references/review-playbooks.md").unlink()
        assert_invalid(trial, "missing required resource", "missing playbooks")

        for review_type in REVIEW_TYPES:
            trial = clone(f"route-{review_type}")
            replace(
                trial / "references/review-playbooks.md",
                re.escape(review_type),
                "removed-route",
                re.IGNORECASE,
            )
            assert_invalid(trial, f"omit required review type: {review_type}", review_type)

        for label, phrase in PLAYBOOK_CONTRACTS.items():
            trial = clone(f"playbook-{label.replace(' ', '-')}")
            replace(
                trial / "references/review-playbooks.md",
                r"\s+".join(r"`?" + re.escape(part) + r"`?" for part in phrase.split()),
                "removed-contract",
                re.IGNORECASE,
            )
            assert_invalid(trial, f"omit {label}", label)

        trial = clone("runner-identity")
        replace(trial / "scripts/run_dual_review.py", "claude", "alpha", re.IGNORECASE)
        assert_invalid(trial, "runner omits claude", "runner identity")

        body_mutations = {
            "exact-two": (r"exactly two", "multiple", "exactly two review voices"),
            "frozen-hash": (r"frozen", "immutable", "same frozen hash"),
            "parallel": (r"parallel", "together", "parallel reviewer execution"),
            "failure-nonpass": (r"never PASS", "may PASS", "failing cannot produce PASS"),
            "review-only": (r"review-only", "review scoped", "review-only behavior"),
            "auto-fix": (r"auto-fix", "apply changes", "forbid automatic fixes"),
            "static-only": (r"static-only", "static analysis", "static-only review"),
            "return-only": (r"return-only", "handoff packet", "return-only wayne-verify"),
        }
        for name, (pattern, value, needle) in body_mutations.items():
            trial = clone(name)
            replace(trial / "SKILL.md", pattern, value, re.IGNORECASE)
            assert_invalid(trial, needle, name)

        forbidden = {
            "claude-home": ("Use ~/.claude/skills/reviewer.\n", "Claude home path"),
            "subagent-type": ("Set subagent_type to reviewer.\n", "subagent_type"),
            "codex-exec": ("Run codex exec for review.\n", "codex exec"),
            "agent-tool": ("Use the Agent tool.\n", "Agent tool"),
            "forbidden-dependency": ("Invoke gstack for review.\n", "forbidden dependency"),
        }
        for name, (content, needle) in forbidden.items():
            trial = clone(name)
            path = trial / "references/review-playbooks.md"
            path.write_text(path.read_text(encoding="utf-8") + "\n" + content, encoding="utf-8")
            assert_invalid(trial, needle, name)

    print(f"PASS: 1 positive and {count} independent static mutations")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
