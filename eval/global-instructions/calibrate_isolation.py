#!/usr/bin/env python3
"""Calibrate global-instruction isolation and paired-input checks."""

from __future__ import annotations

import hashlib
import json
import shutil
import subprocess
import tempfile
from pathlib import Path

from check_discovery import CLAUDE_CORE_AGENTS, CLAUDE_CORE_SKILLS, HARNESS, check as check_discovery
from check_pair import check as check_pair


def write_json(path: Path, value: object) -> None:
    path.write_text(json.dumps(value) + "\n", encoding="utf-8")


def digest(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def seed(root: Path, agent: str) -> tuple[Path, Path]:
    workspace, state = root / f"workspace-{agent}", root / f"state-{agent}"
    repo = workspace / "repo"
    repo.mkdir(parents=True)
    (repo / "README.md").write_text("fixture\n", encoding="utf-8")
    subprocess.run(["git", "init", "-q"], cwd=repo, check=True)
    subprocess.run(["git", "config", "user.name", "Eval"], cwd=repo, check=True)
    subprocess.run(["git", "config", "user.email", "eval@example.invalid"], cwd=repo, check=True)
    subprocess.run(["git", "add", "."], cwd=repo, check=True)
    subprocess.run(["git", "commit", "-q", "-m", "fixture"], cwd=repo, check=True)
    (workspace / "instructions.md").write_text("Return GLOBAL_INSTRUCTION_SENTINEL.\n", encoding="utf-8")
    (workspace / "task.md").write_text("Return the marker.\n", encoding="utf-8")
    (workspace / "instructions.sha256").write_text(digest(workspace / "instructions.md") + "\n", encoding="utf-8")
    tree = subprocess.run(["git", "rev-parse", "HEAD^{tree}"], cwd=repo, check=True, capture_output=True, text=True).stdout.strip()
    write_json(workspace / "input-manifest.json", {
        "case": "discovery-probe",
        "candidate_sha256": digest(workspace / "instructions.md"),
        "task_sha256": digest(workspace / "task.md"),
        "base_tree": tree,
        "harness_sha256": (HARNESS / "harness.sha256").read_text(encoding="utf-8").split()[0],
        "workspace_id": hashlib.sha256(str(workspace.resolve()).encode()).hexdigest(),
        "workspace_path": str(workspace.resolve()),
    })
    state_id = hashlib.sha256(str(state.resolve()).encode()).hexdigest()
    write_json(workspace / "run-status.json", {
        "agent": agent, "model": "fixture-model", "effort": "high",
        "status": "complete", "state_id": state_id,
        "state_path": str(state.resolve()), "exit_code": 0,
    })
    home = state / f"{agent}-home"
    (home / "skills/fixture-sentinel").mkdir(parents=True)
    (home / "skills/fixture-sentinel/SKILL.md").write_text("fixture\n", encoding="utf-8")
    if agent == "claude":
        write_json(home / "settings.json", {"env": {}})
        write_json(workspace / "claude-result.json", {"result": "GLOBAL_INSTRUCTION_SENTINEL"})
        write_json(workspace / "claude-trace.jsonl", {
            "type": "system", "subtype": "init", "plugins": [],
            "skills": sorted(CLAUDE_CORE_SKILLS | {"fixture-sentinel"}),
            "agents": sorted(CLAUDE_CORE_AGENTS),
        })
    else:
        (home / "config.toml").write_text('model_provider = "fixture"\n[model_providers.fixture]\nname = "fixture"\n', encoding="utf-8")
        (workspace / "codex-final.txt").write_text("GLOBAL_INSTRUCTION_SENTINEL\n", encoding="utf-8")
    return workspace, state


def expect_finding(findings: list[str], needle: str, label: str) -> None:
    if not any(needle in finding for finding in findings):
        raise AssertionError(f"{label} escaped {needle!r}: {findings}")


def main() -> int:
    with tempfile.TemporaryDirectory(prefix="global-isolation-") as temp:
        root = Path(temp)
        claude, claude_state = seed(root / "positive-claude", "claude")
        codex, codex_state = seed(root / "positive-codex", "codex")
        if findings := check_discovery(claude.resolve(), "claude"):
            raise AssertionError(f"positive Claude: {findings}")
        if findings := check_discovery(codex.resolve(), "codex"):
            raise AssertionError(f"positive Codex: {findings}")
        if findings := check_pair(claude.resolve(), codex.resolve()):
            raise AssertionError(f"positive pair: {findings}")

        discovery_mutations: list[tuple[str, str, object]] = []
        discovery_mutations.append(("claude-hook", "hook event", lambda w, s: (w / "claude-trace.jsonl").write_text((w / "claude-trace.jsonl").read_text() + '{"type":"system","subtype":"hook_started"}\n')))
        discovery_mutations.append(("claude-context", "additionalContext", lambda w, s: (w / "claude-trace.jsonl").write_text((w / "claude-trace.jsonl").read_text() + '{"additionalContext":"injected"}\n')))
        discovery_mutations.append(("claude-plugin", "loaded a plugin", lambda w, s: (w / "claude-trace.jsonl").write_text((w / "claude-trace.jsonl").read_text().replace('"plugins": []', '"plugins": ["extra"]'))))
        discovery_mutations.append(("claude-skill", "skill owners differ", lambda w, s: (w / "claude-trace.jsonl").write_text((w / "claude-trace.jsonl").read_text().replace('"fixture-sentinel"', '"fixture-sentinel", "extra-skill"', 1))))
        discovery_mutations.append(("claude-agent", "custom agent", lambda w, s: (w / "claude-trace.jsonl").write_text((w / "claude-trace.jsonl").read_text().replace('"Plan"', '"Plan", "custom-agent"', 1))))
        discovery_mutations.append(("claude-settings", "settings contain instruction owners", lambda w, s: write_json(s / "claude-home/settings.json", {"env": {}, "hooks": {}})))
        discovery_mutations.append(("claude-home-skill", "skills beyond fixture", lambda w, s: (s / "claude-home/skills/extra").mkdir()))
        for index, (label, needle, mutate) in enumerate(discovery_mutations):
            workspace, state = seed(root / f"mutation-{index}-{label}", "claude")
            mutate(workspace, state)
            expect_finding(check_discovery(workspace.resolve(), "claude"), needle, label)

        codex_mutations: list[tuple[str, str, object]] = [
            ("codex-override", "AGENTS.override", lambda w, s: (s / "codex-home/AGENTS.override.md").write_text("override\n")),
            ("codex-skill", "skills beyond fixture", lambda w, s: (s / "codex-home/skills/extra").mkdir()),
            ("codex-hook", "config contains extra owners", lambda w, s: (s / "codex-home/config.toml").write_text((s / "codex-home/config.toml").read_text() + "\n[hooks]\n")),
        ]
        for index, (label, needle, mutate) in enumerate(codex_mutations):
            workspace, state = seed(root / f"mutation-codex-{index}-{label}", "codex")
            mutate(workspace, state)
            expect_finding(check_discovery(workspace.resolve(), "codex"), needle, label)

        workspace, _ = seed(root / "mutation-instruction", "claude")
        (workspace / "instructions.md").write_text("changed\n", encoding="utf-8")
        expect_finding(check_discovery(workspace.resolve(), "claude"), "candidate_sha256 differs", "instruction mutation")
        workspace, _ = seed(root / "mutation-invalid", "codex")
        status = json.loads((workspace / "run-status.json").read_text())
        status["status"] = "invalid"
        write_json(workspace / "run-status.json", status)
        expect_finding(check_discovery(workspace.resolve(), "codex"), "not a complete", "invalid run")

        pair_mutations = [
            ("candidate", "candidate_sha256", "paired input differs: candidate_sha256"),
            ("task", "task_sha256", "paired input differs: task_sha256"),
            ("tree", "base_tree", "paired input differs: base_tree"),
            ("harness", "harness_sha256", "paired input differs: harness_sha256"),
        ]
        for index, (label, field, needle) in enumerate(pair_mutations):
            c, _ = seed(root / f"pair-{index}-{label}-c", "claude")
            x, _ = seed(root / f"pair-{index}-{label}-x", "codex")
            manifest = json.loads((x / "input-manifest.json").read_text())
            manifest[field] = "different"
            write_json(x / "input-manifest.json", manifest)
            expect_finding(check_pair(c.resolve(), x.resolve()), needle, label)

        c, _ = seed(root / "pair-workspace-c", "claude"); x, _ = seed(root / "pair-workspace-x", "codex")
        cm = json.loads((c / "input-manifest.json").read_text()); xm = json.loads((x / "input-manifest.json").read_text())
        xm["workspace_id"] = cm["workspace_id"]; write_json(x / "input-manifest.json", xm)
        expect_finding(check_pair(c.resolve(), x.resolve()), "reused a workspace", "workspace reuse")
        c, _ = seed(root / "pair-state-c", "claude"); x, _ = seed(root / "pair-state-x", "codex")
        cr = json.loads((c / "run-status.json").read_text()); xr = json.loads((x / "run-status.json").read_text())
        xr["state_id"] = cr["state_id"]; write_json(x / "run-status.json", xr)
        expect_finding(check_pair(c.resolve(), x.resolve()), "reused run state", "state reuse")
        c, _ = seed(root / "pair-invalid-c", "claude"); x, _ = seed(root / "pair-invalid-x", "codex")
        xr = json.loads((x / "run-status.json").read_text()); xr["status"] = "invalid"; write_json(x / "run-status.json", xr)
        expect_finding(check_pair(c.resolve(), x.resolve()), "invalid or incomplete", "pair invalid")

    print("PASS: 3 positive isolation lanes and 19 independent mutations")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
