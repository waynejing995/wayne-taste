#!/usr/bin/env python3
"""Calibrate Wayne Triage routes, handoffs, and hard boundaries."""

from __future__ import annotations

import json
import shutil
import tempfile
from pathlib import Path

from check_trial import CASES, INTERNAL, validate


HARNESS = Path(__file__).resolve().parent


def write(path: Path, text: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding="utf-8")


def seed(workspace: Path, case: str) -> Path:
    repo = workspace / "repo"
    shutil.copytree(HARNESS / "fixture", repo)
    shutil.copytree(HARNESS / "cases" / case, repo, dirs_exist_ok=True)
    return repo


def evidence_values(case: str) -> tuple[str, str, str, str, str, str, str, int]:
    values = {
        "failure": ("failure", "wrong-output", "logic", "tokenizer", "1", "internal", "fix-now", 1),
        "approval-denied": ("failure", "wrong-output", "logic", "tokenizer", "1", "internal", "fix-now", 1),
        "tracker": ("tracker", "enhancement", "architecture", "dispatcher", "140", "shared", "needs-plan", 1),
        "multiple-signal": ("tracker", "bug", "config", "config", "12", "shared", "needs-plan", 1),
        "no-match": ("failure", "unknown", "unknown", "unknown", "0", "internal", "needs-info", 1),
        "architecture": ("failure", "wrong-output", "architecture", "retry-controller", "80", "shared", "escalate-architecture", 3),
        "external-owner": ("failure", "config-env", "environment", "external-network", "0", "shared", "route-to-owner", 1),
    }
    return values[case]


def evidence_text(case: str) -> str:
    surface, symptom, cause, component, lines, blast, route, count = evidence_values(case)
    signals = {
        "stack_trace": case == "multiple-signal",
        "deadlock_hang": False,
        "flaky_pattern": False,
        "perf_delta": False,
        "env_skew": case in {"multiple-signal", "external-owner"},
    }
    repro = "uv run --no-project python -m unittest tests.test_tokenizer — FAIL observed"
    if case == "tracker":
        repro = "not applicable to approved enhancement"
    elif case == "multiple-signal":
        repro = "tests.test_region_contract — KeyError observed"
    elif case == "no-match":
        repro = "non-deterministic: request exact expected vs actual"
    elif case == "architecture":
        repro = "tests.test_config — FAIL after three attempted fixes"
    elif case == "external-owner":
        repro = "5 of 5 captured requests returned provider 503"
    signal_lines = "\n".join(f"- {key}: {str(value).lower()}" for key, value in signals.items())
    return f"""---
slug: {case}
date: 2026-07-17
surface: {surface}
symptom_class: {symptom}
cause_category: {cause}
component: {component}
est_lines: {lines}
blast_radius: {blast}
route: {route}
repro_count: {count}
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
- justified_by: blast_radius={blast}; est_lines={lines}; repro_count={count}
- handoff: next action
"""


def packet_text(evidence: Path, route: str, agent: str, repo: Path) -> str:
    snapshot = evidence.relative_to(repo).as_posix()
    return f"""---
title: triage handoff
status: handoff
branch: main
timestamp: 2026-07-17T00:00:00+08:00
pipeline_stage: triage
pipeline_phase: route approved
route: {route}
snapshot: {snapshot}
next_agent: {agent}
trigger: manual
goal_included: true
---

## Handoff: triage to {agent}

### Snapshot
- Primary snapshot: `{snapshot}`

### Next Agent
| Field | Value |
|---|---|
| Next agent | `{agent}` |
| Trigger | manual |
| Auto-advance | NO |

### Next Prompt
Read the snapshot. Preserve acceptance criteria and out of scope boundaries.
"""


def valid(workspace: Path, case: str) -> Path:
    repo = seed(workspace, case)
    output = workspace / "output.txt"
    if case == "missing-data":
        write(output, "缺少工单内容和拉取方式。应该从哪里、用什么命令获取 SWDEV-123？")
        return output
    evidence = repo / ".wayne/triage" / f"2026-07-17-{case}.md"
    write(evidence, evidence_text(case))
    route = evidence_values(case)[6]
    if case == "no-match":
        write(output, "route: needs-info。请提供最小的 expected vs actual 或可复现的可观察症状？")
        return output
    if case == "approval-denied":
        write(output, "route=fix-now；handoff approval denied，未生成交接包。")
        return output
    if case == "external-owner":
        write(output, """route-to-owner

## 执行摘要
The external network owner owns the confirmed cause.

## 建议的下一步
Send NET-88 to that owner.

验收标准：provider service is restored.
范围外：local adapter changes.
""")
        return output
    agent = INTERNAL[case][1]
    write(repo / ".wayne/checkpoints/handoff.md", packet_text(evidence, route, agent, repo))
    state = ""
    if case == "tracker":
        state = " category=enhancement state=ready-for-agent"
    elif case == "multiple-signal":
        state = " category=bug state=ready-for-agent"
    write(output, f"route={route}{state}; next={agent}; trigger=manual")
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
        for case in sorted(CASES):
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
        write(evidence, evidence.read_text(encoding="utf-8").replace("route: fix-now", "route: needs-plan", 1))
        assert_invalid(wrong_route, "failure", wrong_route / "output.txt", "route must be", "wrong route")

        body_route = clone(valids["failure"], root, "body-route")
        evidence = next((body_route / "repo/.wayne/triage").glob("*.md"))
        write(evidence, evidence.read_text(encoding="utf-8").replace("- verdict: fix-now", "- verdict: needs-plan"))
        assert_invalid(body_route, "failure", body_route / "output.txt", "disagree", "route copies")

        wrong_agent = clone(valids["failure"], root, "wrong-agent")
        packet = next((wrong_agent / "repo/.wayne/checkpoints").glob("*.md"))
        write(packet, packet.read_text(encoding="utf-8").replace("wayne-test-design", "wayne-plan"))
        assert_invalid(wrong_agent, "failure", wrong_agent / "output.txt", "next_agent must be", "wrong agent")

        auto = clone(valids["failure"], root, "auto")
        packet = next((auto / "repo/.wayne/checkpoints").glob("*.md"))
        write(packet, packet.read_text(encoding="utf-8").replace("Auto-advance | NO", "Auto-advance | YES"))
        assert_invalid(auto, "failure", auto / "output.txt", "Auto-advance NO", "auto advance")

        snapshot = clone(valids["architecture"], root, "wrong-snapshot")
        packet = next((snapshot / "repo/.wayne/checkpoints").glob("*.md"))
        write(packet, packet.read_text(encoding="utf-8").replace(".wayne/triage/2026-07-17-architecture.md", ".wayne/triage/other.md"))
        assert_invalid(snapshot, "architecture", snapshot / "output.txt", "snapshot must be", "snapshot")

        denied = clone(valids["approval-denied"], root, "denied-packet")
        write(denied / "repo/.wayne/checkpoints/bad.md", "next_agent: wayne-test-design\n")
        assert_invalid(denied, "approval-denied", denied / "output.txt", "emitted a checkpoint", "approval")

        external = clone(valids["external-owner"], root, "external-packet")
        write(external / "repo/.wayne/checkpoints/bad.md", "next_agent: external-owner\n")
        assert_invalid(external, "external-owner", external / "output.txt", "emitted a Wayne checkpoint", "external")

        tracker = clone(valids["tracker"], root, "tracker-mutation")
        write(tracker / "repo/tracker-state.json", '{"state":"closed"}\n')
        assert_invalid(tracker, "tracker", tracker / "output.txt", "input modified", "tracker mutation")

        signal = clone(valids["multiple-signal"], root, "missing-signal")
        evidence = next((signal / "repo/.wayne/triage").glob("*.md"))
        write(evidence, evidence.read_text(encoding="utf-8").replace("env_skew: true", "env_skew: false"))
        assert_invalid(signal, "multiple-signal", signal / "output.txt", "env_skew: true", "signal")

        premature = clone(valids["missing-data"], root, "premature")
        write(premature / "repo/.wayne/triage/premature.md", evidence_text("tracker"))
        assert_invalid(premature, "missing-data", premature / "output.txt", "wrote evidence", "missing data")

        guessed = clone(valids["no-match"], root, "guessed")
        evidence = next((guessed / "repo/.wayne/triage").glob("*.md"))
        write(evidence, evidence.read_text(encoding="utf-8").replace("symptom_class: unknown", "symptom_class: crash"))
        assert_invalid(guessed, "no-match", guessed / "output.txt", "symptom_class must be", "no match")

    print("PASS: 8 valid routes and 12 independent mutations")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
