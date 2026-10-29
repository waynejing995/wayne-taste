#!/usr/bin/env python3
"""Calibrate Wayne Checkpoint observations, not packet semantics."""

from __future__ import annotations

import shutil
import subprocess
import tempfile
from pathlib import Path

from check_trial import CASES, SANDBOX_STATE, state_root, validate


HARNESS = Path(__file__).resolve().parent


def write(path: Path, text: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding="utf-8")


def seed(root: Path, case: str) -> tuple[Path, Path]:
    workspace = root / case
    repo = workspace / "repo"
    # Seeded Wayne state is not repository content: it lands in WAYNE_HOME, beside repo/.
    ignore = shutil.ignore_patterns("wayne-home")
    shutil.copytree(HARNESS / "fixture", repo, ignore=ignore)
    shutil.copytree(HARNESS / "cases" / case, repo, ignore=ignore, dirs_exist_ok=True)
    for seeded in (HARNESS / "fixture" / "wayne-home", HARNESS / "cases" / case / "wayne-home"):
        if seeded.is_dir():
            shutil.copytree(seeded, workspace / "wayne-home", dirs_exist_ok=True)
    output = workspace / "output.txt"
    subprocess.run(["git", "-C", str(repo), "init", "-q"], check=True)
    subprocess.run(["git", "-C", str(repo), "config", "user.name", "Eval"], check=True)
    subprocess.run(["git", "-C", str(repo), "config", "user.email", "eval@example.invalid"], check=True)
    subprocess.run(["git", "-C", str(repo), "add", "-f", "."], check=True)
    subprocess.run(["git", "-C", str(repo), "commit", "-qm", "fixture"], check=True)
    stage, route, agent, snapshot = CASES[case]
    if not agent:
        write(output, "NO_WAYNE_HANDOFF: escalate-incident is report-only.")
        return workspace, output
    packet = state_root(workspace) / "checkpoints" / "handoff.md"
    write(
        packet,
        f"""---
title: eval
status: handoff
branch: main
timestamp: 2026-07-17T00:00:00+08:00
pipeline_stage: {stage}
pipeline_phase: complete
route: {route}
next_agent: {agent}
trigger: manual
goal_included: true
snapshot: {snapshot}
---

## Handoff

Snapshot: `{snapshot}`.

### Next Agent

`{agent}`

| Field | Value |
|---|---|
| Trigger | manual |
| Auto-advance | NO |

### Next Prompt

Use the snapshot above. Preserve the stated acceptance criteria and out of scope.
""",
    )
    write(output, f"next: {agent}; trigger: manual; packet: {SANDBOX_STATE}/checkpoints/handoff.md")
    return workspace, output


def expect_finding(workspace: Path, case: str, output: Path, needle: str) -> None:
    findings = validate(workspace, case, output)
    if not any(needle in finding for finding in findings):
        raise AssertionError(f"missing {needle!r}: {findings}")


def main() -> int:
    with tempfile.TemporaryDirectory(prefix="checkpoint-calibration-") as temp:
        root = Path(temp)
        valids: dict[str, tuple[Path, Path]] = {}
        for case in CASES:
            valids[case] = seed(root, case)
            findings = validate(valids[case][0], case, valids[case][1])
            if findings:
                raise AssertionError(f"valid {case}: {findings}")

        mutations = {
            "wrong-agent": ("fix-now", "wayne-test-design", "wayne-work", "next_agent must be"),
            "verdict-agent": ("fix-now", "wayne-test-design", "fix-now", "next_agent must be"),
            "chain-agent": ("fix-now", "wayne-test-design", "wayne-test-design -> wayne-plan", "next_agent must be"),
            "missing-manual": ("needs-plan", "trigger: manual", "trigger: automatic", "trigger must be"),
            "wrong-snapshot": (
                "escalate-architecture",
                f"{SANDBOX_STATE}/triage/retry-controller.md",
                f"{SANDBOX_STATE}/triage/other.md",
                "snapshot must be",
            ),
        }
        for name, (case, old, new, needle) in mutations.items():
            source, source_output = valids[case]
            workspace = root / name
            shutil.copytree(source, workspace)
            output = workspace / "output.txt"
            packet = next((state_root(workspace) / "checkpoints").glob("*.md"))
            write(packet, packet.read_text(encoding="utf-8").replace(old, new))
            expect_finding(workspace, case, output, needle)

        source, _ = valids["external"]
        workspace = root / "external-packet"
        shutil.copytree(source, workspace)
        write(state_root(workspace) / "checkpoints" / "bad.md", "next_agent: external-owner\n")
        expect_finding(workspace, "external", workspace / "output.txt", "external route wrote Wayne handoff")

        source, _ = valids["fix-now"]
        workspace = root / "product-edit"
        shutil.copytree(source, workspace)
        subprocess_repo = workspace / "repo"
        write(subprocess_repo / "src/service.py", "# mutated\n")
        expect_finding(workspace, "fix-now", workspace / "output.txt", "product/input modified")

        # Wayne state never belongs in the repository; a repo-local .wayne directory is a violation.
        source, _ = valids["fix-now"]
        workspace = root / "repo-dot-wayne"
        shutil.copytree(source, workspace)
        write(workspace / "repo" / ".wayne" / "checkpoints" / "stray.md", "# stray\n")
        expect_finding(workspace, "fix-now", workspace / "output.txt", "product/input modified")

    print(
        "PASS: observations cover 5 routes and 8 mutations; "
        "semantic verdict remains AI_REVIEW_REQUIRED"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
