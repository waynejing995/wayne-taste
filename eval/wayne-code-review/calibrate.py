#!/usr/bin/env python3
"""Calibrate Code Review observations, not report semantics."""

from __future__ import annotations

import json
import shutil
import subprocess
import tempfile
from pathlib import Path

from calibrate_dual_evidence import valid_bundle
from check_trial import check, patch_sha


HARNESS = Path(__file__).resolve().parent
SKILL = HARNESS.parent.parent / "wayne-code-review"


def seed(root: Path, case_name: str) -> Path:
    subprocess.run(
        ["bash", str(HARNESS / "prepare_trial.sh"), case_name, SKILL, root],
        check=True,
    )
    return root


def write(path: Path, text: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding="utf-8")


def target_output() -> str:
    return (
        "STATUS: FAIL\n"
        "[CRITICAL] (confidence: 10/10) src/export.py:8 — shell command injection: "
        "untrusted report_path and destination_path reach shell=True.\n"
        "Fix: use shutil.copy2 or an argv-only subprocess call.\n"
        "Sources: Claude + Codex; runtime: UNVERIFIED."
    )


def dataflow_rows() -> list[dict[str, object]]:
    return [
        {
            "severity": "CRITICAL",
            "confidence": 10,
            "category": "dataflow-half-migration",
            "file": "src/delivery/retry.py",
            "line": 7,
            "problem": (
                "TeamConfig.timeout_ms flows through resolve_timeout for primary but retry "
                "still reads DEFAULT_TIMEOUT_MS, so beta gets wrong value 1000 instead of 2400."
            ),
            "evidence": [
                "producer TeamConfig.timeout_ms",
                "canonical seam resolve_timeout",
                "stale retry consumer DEFAULT_TIMEOUT_MS at src/delivery/retry.py:7",
            ],
            "fix": "Route retry_timeout through resolve_timeout(config).",
        }
    ]


def dataflow_output() -> str:
    return (
        "STATUS: FAIL\n"
        "[CRITICAL] src/delivery/retry.py:7 — half-migration: producer "
        "TeamConfig.timeout_ms and resolver resolve_timeout control primary, but the stale "
        "retry consumer still reads DEFAULT_TIMEOUT_MS. The beta team receives wrong value "
        "1000 instead of 2400. Fix retry_timeout to use resolve_timeout(config).\n"
        "Sources: Claude + Codex; runtime: UNVERIFIED."
    )


def disagreement_output() -> str:
    return (
        "VERDICT: FAIL\nRUNTIME: UNVERIFIED\n"
        "DUAL-VOICE CONFIRMED: shell-command-injection — CRITICAL at src/archive.py:30 "
        "(sources: Claude, Codex).\n"
        "UNRESOLVED disagreement: overwrite-default-compatibility at src/archive.py:24. "
        "Claude: CRITICAL because callers omitting overwrite change behavior. "
        "Codex: NOT_A_FINDING because no public compatibility contract is proven."
    )


def assert_valid(workspace: Path, case_name: str, output: Path) -> None:
    findings = check(workspace, case_name, output)
    if findings:
        raise AssertionError(f"valid {case_name} failed: {findings}")


def assert_invalid(workspace: Path, case_name: str, output: Path, needle: str, label: str) -> None:
    findings = check(workspace, case_name, output)
    if not any(needle in finding for finding in findings):
        raise AssertionError(f"{label} missing {needle!r}: {json.dumps(findings, ensure_ascii=False)}")


def clone(source: Path, root: Path, name: str) -> Path:
    target = root / name
    shutil.copytree(source, target)
    return target


def main() -> int:
    with tempfile.TemporaryDirectory(prefix="wayne-code-review-calibration-") as temp:
        root = Path(temp)

        target = seed(root / "target", "security-only-routing")
        valid_bundle(target / "review-evidence", patch_sha(target / "repo"), "security")
        write(target / "output.txt", target_output())
        assert_valid(target, "security-only-routing", target / "output.txt")

        safe = seed(root / "safe", "security-safe-neighbor")
        valid_bundle(safe / "review-evidence", patch_sha(safe / "repo"), "security", [])
        write(safe / "output.txt", "STATUS: PASS\nNO FINDINGS\nSources: Claude + Codex.")
        assert_valid(safe, "security-safe-neighbor", safe / "output.txt")

        dataflow = seed(root / "dataflow", "dataflow-half-migration")
        valid_bundle(
            dataflow / "review-evidence",
            patch_sha(dataflow / "repo"),
            "dataflow",
            dataflow_rows(),
        )
        write(dataflow / "output.txt", dataflow_output())
        assert_valid(dataflow, "dataflow-half-migration", dataflow / "output.txt")

        disagreement = seed(root / "disagreement", "disagreement-synthesis")
        write(disagreement / "output.txt", disagreement_output())
        assert_valid(disagreement, "disagreement-synthesis", disagreement / "output.txt")

        mutations = {
            "wrong-line": (target, "security-only-routing", target_output().replace("src/export.py:8", "src/export.py:7"), "line 8"),
            "wrong-severity": (target, "security-only-routing", target_output().replace("CRITICAL", "INFORMATIONAL"), "CRITICAL"),
            "missing-mechanism": (target, "security-only-routing", target_output().replace("shell command injection", "unsafe code"), "injection mechanism"),
            "decoy": (target, "security-only-routing", target_output() + "\n[INFORMATIONAL] unused import sys.", "non-security decoy"),
            "safe-false-positive": (safe, "security-safe-neighbor", "[CRITICAL] src/export.py:7 — shell command injection.", "falsely reported"),
            "dataflow-endpoint": (dataflow, "dataflow-half-migration", dataflow_output().replace("resolve_timeout", "resolver"), "resolve_timeout"),
            "dataflow-severity": (dataflow, "dataflow-half-migration", dataflow_output().replace("CRITICAL", "INFORMATIONAL"), "not CRITICAL"),
            "disagreement-missing": (disagreement, "disagreement-synthesis", disagreement_output().replace("overwrite-default-compatibility", "compatibility"), "compatibility disagreement"),
            "disagreement-resolved": (disagreement, "disagreement-synthesis", disagreement_output().replace("UNRESOLVED disagreement", "Resolved in Claude's favor"), "preserving it"),
        }
        for name, (source, case_name, content, needle) in mutations.items():
            trial = clone(source, root, name)
            write(trial / "output.txt", content)
            assert_invalid(trial, case_name, trial / "output.txt", needle, name)

        invoked = clone(disagreement, root, "synthesis-reviewer-invocation")
        (invoked / "review-evidence").mkdir()
        assert_invalid(
            invoked,
            "disagreement-synthesis",
            invoked / "output.txt",
            "invoked reviewers",
            "synthesis reviewer boundary",
        )

        mutated = clone(target, root, "repository-write")
        write(mutated / "repo/src/export.py", "# review modified product code\n")
        assert_invalid(
            mutated,
            "security-only-routing",
            mutated / "output.txt",
            "changed the frozen tracked diff",
            "write boundary",
        )

    print(
        "PASS: observations cover 4 cases and 11 mutations; "
        "semantic verdict remains AI_REVIEW_REQUIRED"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
