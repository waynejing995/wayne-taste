#!/usr/bin/env python3
"""Calibrate Wayne Triage routes and hard boundaries."""

from __future__ import annotations

import json
import shutil
import tempfile
from pathlib import Path

from check_trial import validate


HARNESS = Path(__file__).resolve().parent


def write(path: Path, text: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding="utf-8")


def seed(workspace: Path, case: str) -> Path:
    repo = workspace / "repo"
    shutil.copytree(HARNESS / "fixture", repo)
    shutil.copytree(HARNESS / "cases" / case, repo, dirs_exist_ok=True)
    return repo


def evidence_text(case: str) -> str:
    values = {
        "failure": ("failure", "wrong-output", "logic", "tokenizer", "1", "internal", "fix-now"),
        "tracker": ("tracker", "enhancement", "architecture", "dispatcher", "140", "shared", "needs-plan"),
        "multiple-signal": ("tracker", "bug", "config", "config", "12", "shared", "needs-plan"),
        "no-match": ("failure", "unknown", "unknown", "unknown", "0", "internal", "needs-info"),
    }
    surface, symptom, cause, component, lines, blast, route = values[case]
    signals = {
        "stack_trace": case == "multiple-signal",
        "deadlock_hang": False,
        "flaky_pattern": False,
        "perf_delta": False,
        "env_skew": case == "multiple-signal",
    }
    repro = (
        "uv run --no-project python -m unittest tests.test_tokenizer — FAIL observed"
        if case == "failure"
        else "not applicable to approved enhancement"
    )
    if case == "multiple-signal":
        repro = "env -u SERVICE_REGION uv run --no-project python -c ... — KeyError observed"
    if case == "no-match":
        repro = "non-deterministic: no observable supplied; request exact expected vs actual"
    signal_lines = "\n".join(f"- {key}: {str(value).lower()}" for key, value in signals.items())
    return f"""---
slug: {case}
date: 2026-07-16
surface: {surface}
symptom_class: {symptom}
cause_category: {cause}
component: {component}
est_lines: {lines}
blast_radius: {blast}
route: {route}
repro_count: 1
---

# Triage: {case}

## Symptom
- verbatim: "fixture symptom" [OBSERVED] case.md:1

## Repro
- command: {repro} [OBSERVED] case.md:1

## Classify
- symptom_axis: {symptom}
- cause_axis: {cause}

## Signals
{signal_lines}

## Hypothesis matrix
| evidence | H1 | H2 |
|---|---|---|
| fixture [OBSERVED] case.md:1 | ++ | -- |

## Attribution
- symptom_layer: input
- cause_layer: {component}
- verdict: AGREE
- responsible: {component}

## Route
- verdict: {route}
- justified_by: blast_radius={blast}; est_lines={lines}; repro=case.md:1
- handoff: next stage
"""


def valid(workspace: Path, case: str) -> Path:
    repo = seed(workspace, case)
    output = workspace / "output.txt"
    if case == "missing-data":
        write(output, "缺少工单内容和拉取方式。应该从哪里、用什么命令获取 SWDEV-123？")
        return output

    evidence = repo / ".wayne" / "triage" / f"2026-07-16-{case}.md"
    write(evidence, evidence_text(case))
    if case == "no-match":
        write(output, "route: needs-info。请提供最小的 expected vs actual 或可复现的可观察症状？")
        return output

    route = "fix-now" if case == "failure" else "needs-plan"
    state = "" if case == "failure" else " category=enhancement state=ready-for-agent"
    if case == "multiple-signal":
        state = " category=bug state=ready-for-agent"
    write(
        repo / ".wayne" / "checkpoints" / "handoff.md",
        f"""status: triaged
next_agent: wayne-plan
snapshot: {evidence.relative_to(repo).as_posix()}
route: {route}
next_prompt: Deliver the accepted behavior and tests.
out of scope: unrelated source and tracker state.
""",
    )
    write(output, f"route={route}{state}; evidence={evidence.relative_to(repo).as_posix()}")
    return output


def assert_valid(workspace: Path, case: str, output: Path) -> None:
    findings = validate(workspace, case, output)
    if findings:
        raise AssertionError(f"valid {case} failed: {findings}")


def assert_invalid(workspace: Path, case: str, output: Path, needle: str, label: str) -> None:
    findings = validate(workspace, case, output)
    if not any(needle in finding for finding in findings):
        raise AssertionError(f"{label} missing {needle!r}: {json.dumps(findings, ensure_ascii=False)}")


def clone(source: Path, root: Path, name: str) -> Path:
    target = root / name
    shutil.copytree(source, target)
    return target


def main() -> int:
    with tempfile.TemporaryDirectory(prefix="triage-calibration-") as temp:
        root = Path(temp)
        valids: dict[str, Path] = {}
        for case in ("failure", "tracker", "missing-data", "multiple-signal", "no-match"):
            workspace = root / f"valid-{case}"
            workspace.mkdir()
            output = valid(workspace, case)
            assert_valid(workspace, case, output)
            valids[case] = workspace

        source_edit = clone(valids["failure"], root, "source-edit")
        write(source_edit / "repo/src/tokenizer.py", "# mutated\n")
        assert_invalid(source_edit, "failure", source_edit / "output.txt", "input modified", "source boundary")

        wrong_route = clone(valids["failure"], root, "wrong-route")
        evidence = next((wrong_route / "repo/.wayne/triage").glob("*.md"))
        write(evidence, evidence.read_text(encoding="utf-8").replace("route: fix-now", "route: needs-plan"))
        assert_invalid(wrong_route, "failure", wrong_route / "output.txt", "route must be 'fix-now'", "wrong route")

        tracker_mutation = clone(valids["tracker"], root, "tracker-mutation")
        write(tracker_mutation / "repo/tracker-state.json", '{"state":"closed"}\n')
        assert_invalid(tracker_mutation, "tracker", tracker_mutation / "output.txt", "input modified", "tracker mutation")

        missing_signal = clone(valids["multiple-signal"], root, "missing-signal")
        evidence = next((missing_signal / "repo/.wayne/triage").glob("*.md"))
        write(evidence, evidence.read_text(encoding="utf-8").replace("env_skew: true", "env_skew: false"))
        assert_invalid(missing_signal, "multiple-signal", missing_signal / "output.txt", "env_skew: true", "multiple signal")

        premature = clone(valids["missing-data"], root, "premature-route")
        write(premature / "repo/.wayne/triage/premature.md", evidence_text("tracker"))
        assert_invalid(premature, "missing-data", premature / "output.txt", "wrote evidence before data", "missing data")

        guessed = clone(valids["no-match"], root, "guessed-playbook")
        evidence = next((guessed / "repo/.wayne/triage").glob("*.md"))
        write(
            evidence,
            evidence.read_text(encoding="utf-8")
            .replace("symptom_class: unknown", "symptom_class: crash")
            .replace("stack_trace: false", "stack_trace: true"),
        )
        assert_invalid(guessed, "no-match", guessed / "output.txt", "symptom_class must be 'unknown'", "no match")

        no_marker = clone(valids["tracker"], root, "no-observed-marker")
        evidence = next((no_marker / "repo/.wayne/triage").glob("*.md"))
        write(evidence, evidence.read_text(encoding="utf-8").replace("[OBSERVED]", "[INFERRED]"))
        assert_invalid(no_marker, "tracker", no_marker / "output.txt", "no [OBSERVED]", "evidence marker")

    print("PASS: 5 positive routes and 7 independent mutations")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
