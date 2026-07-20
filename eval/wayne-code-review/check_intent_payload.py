#!/usr/bin/env python3
"""Calibrate caller-selected intent freezing in the dual-review payload."""

from __future__ import annotations

import argparse
import hashlib
import importlib.util
import sys
import tempfile
from pathlib import Path
from types import ModuleType


def load_runner(skill: Path) -> ModuleType:
    path = skill / "scripts/run_dual_review.py"
    spec = importlib.util.spec_from_file_location("wayne_dual_review_for_eval", path)
    if spec is None or spec.loader is None:
        raise AssertionError(f"cannot load runner: {path}")
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


def expect_runtime_error(action, label: str) -> None:
    try:
        action()
    except RuntimeError:
        return
    raise AssertionError(f"{label} did not fail loud")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("skill", type=Path)
    args = parser.parse_args()
    runner = load_runner(args.skill.resolve())

    with tempfile.TemporaryDirectory(prefix="review-intent-payload-") as temp:
        root = Path(temp)
        repo = root / "repo"
        source = repo / "docs/specs/approved.md"
        source.parent.mkdir(parents=True)
        source.write_bytes(b"# Approved intent\r\n\r\nRetry timeout is team-owned.\r\n")
        summary = root / "intent-summary.md"
        summary.write_text("Review both timeout consumers against the approved spec.\n", encoding="utf-8")

        sources = runner.load_intent_sources(repo, ["docs/specs/approved.md"])
        loaded_summary = runner.load_intent_summary(summary)
        payload = runner.build_payload(
            "intent-scope",
            "b" * 40,
            "h" * 40,
            "a" * 64,
            b"diff --git a/x b/x\n",
            {},
            "## Intent and scope\nCompare both directions.",
            sources,
            loaded_summary,
        )
        text = payload.decode("utf-8")
        source_sha = hashlib.sha256(source.read_bytes()).hexdigest()
        summary_sha = hashlib.sha256(summary.read_bytes()).hexdigest()
        for expected in (
            "CALLER INTENT PACKET BEGIN",
            "docs/specs/approved.md",
            source_sha,
            "Retry timeout is team-owned.",
            summary_sha,
            "Review both timeout consumers",
        ):
            if expected not in text:
                raise AssertionError(f"payload omitted frozen intent evidence: {expected}")

        source.write_text("# Changed after freeze\n", encoding="utf-8")
        frozen_again = runner.build_payload(
            "intent-scope",
            "b" * 40,
            "h" * 40,
            "a" * 64,
            b"diff --git a/x b/x\n",
            {},
            "## Intent and scope\nCompare both directions.",
            sources,
            loaded_summary,
        )
        if frozen_again != payload:
            raise AssertionError("payload reread a moving intent source after freeze")
        changed_sources = runner.load_intent_sources(repo, ["docs/specs/approved.md"])
        changed_payload = runner.build_payload(
            "intent-scope",
            "b" * 40,
            "h" * 40,
            "a" * 64,
            b"diff --git a/x b/x\n",
            {},
            "## Intent and scope\nCompare both directions.",
            changed_sources,
            loaded_summary,
        )
        if changed_payload == payload:
            raise AssertionError("changed intent bytes did not change the provider payload")

        outside = root / "outside.md"
        outside.write_text("outside\n", encoding="utf-8")
        expect_runtime_error(
            lambda: runner.load_intent_sources(repo, ["../outside.md"]),
            "repository escape",
        )
        expect_runtime_error(
            lambda: runner.load_intent_sources(repo, [str(outside)]),
            "absolute intent path",
        )
        expect_runtime_error(
            lambda: runner.load_intent_sources(repo, ["missing.md"]),
            "missing intent source",
        )
        expect_runtime_error(
            lambda: runner.load_intent_sources(
                repo, ["docs/specs/approved.md", "docs/specs/approved.md"]
            ),
            "duplicate intent source",
        )

    print("PASS: frozen intent bytes, hashes, path containment, and change sensitivity")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
