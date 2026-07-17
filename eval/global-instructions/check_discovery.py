#!/usr/bin/env python3
"""Check global-instruction discovery and the absence of a second instruction owner."""

from __future__ import annotations

import argparse
import hashlib
import json
import subprocess
import tomllib
from pathlib import Path


def digest(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def json_lines(path: Path) -> list[dict[str, object]]:
    rows: list[dict[str, object]] = []
    for line in path.read_text(encoding="utf-8").splitlines():
        try:
            row = json.loads(line)
        except json.JSONDecodeError:
            continue
        if isinstance(row, dict):
            rows.append(row)
    return rows


def load_json(path: Path) -> dict[str, object]:
    value = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(value, dict):
        raise TypeError(f"expected JSON object: {path}")
    return value


def only_fixture_skill(home: Path) -> bool:
    skills = home / "skills"
    visible = sorted(path.name for path in skills.iterdir() if not path.name.startswith(".")) if skills.is_dir() else []
    return visible == ["fixture-sentinel"]


CLAUDE_CORE_SKILLS = {
    "deep-research", "design-sync", "dataviz", "update-config", "verify", "debug",
    "code-review", "simplify", "batch", "fewer-permission-prompts", "doctor", "loop",
    "claude-api", "run", "run-skill-generator",
}
CLAUDE_CORE_AGENTS = {"claude", "Explore", "general-purpose", "Plan", "statusline-setup"}
HARNESS = Path(__file__).resolve().parent


def check(workspace: Path, agent: str) -> list[str]:
    findings: list[str] = []
    try:
        inputs = load_json(workspace / "input-manifest.json")
        run = load_json(workspace / "run-status.json")
    except (OSError, json.JSONDecodeError, TypeError) as error:
        return [f"manifest missing or invalid: {error}"]

    instruction = workspace / "instructions.md"
    task = workspace / "task.md"
    repo = workspace / "repo"
    actual_tree = subprocess.run(
        ["git", "rev-parse", "HEAD^{tree}"], cwd=repo, check=True,
        capture_output=True, text=True,
    ).stdout.strip()
    expected_workspace_id = hashlib.sha256(str(workspace).encode()).hexdigest()
    expected = {
        "candidate_sha256": digest(instruction),
        "task_sha256": digest(task),
        "base_tree": actual_tree,
        "harness_sha256": (HARNESS / "harness.sha256").read_text(encoding="utf-8").split()[0],
        "workspace_id": expected_workspace_id,
        "workspace_path": str(workspace),
    }
    for key, value in expected.items():
        if inputs.get(key) != value:
            findings.append(f"input manifest {key} differs")
    if run.get("agent") != agent or run.get("status") != "complete":
        findings.append("run status is not a complete matching agent cell")
    if not run.get("model") or not run.get("effort"):
        findings.append("run status omits model or effort")
    state_value = run.get("state_path")
    state = Path(state_value) if isinstance(state_value, str) else Path("/__missing_state__")
    if not state.is_dir():
        findings.append("isolated run state is missing")
    elif run.get("state_id") != hashlib.sha256(str(state).encode()).hexdigest():
        findings.append("run status state_id differs")

    if agent == "claude":
        try:
            result = load_json(workspace / "claude-result.json")
            output = str(result.get("result", "")).strip()
            trace = json_lines(workspace / "claude-trace.jsonl")
        except (OSError, json.JSONDecodeError, TypeError):
            output, trace = "", []
        if output != "GLOBAL_INSTRUCTION_SENTINEL":
            findings.append(f"global marker differs: {output!r}")
        if any(str(row.get("subtype", "")).startswith("hook_") for row in trace):
            findings.append("Claude trace contains a hook event")
        raw_trace = (workspace / "claude-trace.jsonl").read_text(encoding="utf-8") if (workspace / "claude-trace.jsonl").is_file() else ""
        if "additionalContext" in raw_trace:
            findings.append("Claude trace contains hook additionalContext")
        init = next((row for row in trace if row.get("type") == "system" and row.get("subtype") == "init"), {})
        if init.get("plugins", []) != []:
            findings.append("Claude loaded a plugin")
        if set(init.get("skills", [])) != CLAUDE_CORE_SKILLS | {"fixture-sentinel"}:
            findings.append(f"Claude skill owners differ: {init.get('skills', [])!r}")
        if set(init.get("agents", [])) != CLAUDE_CORE_AGENTS:
            findings.append(f"Claude loaded a custom agent: {init.get('agents', [])!r}")
        home = state / "claude-home"
        if state.is_dir():
            settings = load_json(home / "settings.json")
            if not set(settings) <= {"env"}:
                findings.append(f"Claude settings contain instruction owners: {sorted(settings)}")
            if not only_fixture_skill(home):
                findings.append("Claude state contains skills beyond fixture-sentinel")
            for name in ("agents", "commands", "plugins", "rules", "output-styles"):
                if (home / name).exists():
                    findings.append(f"Claude state contains extra owner: {name}")
    else:
        path = workspace / "codex-final.txt"
        output = path.read_text(encoding="utf-8").strip() if path.is_file() else ""
        if output != "GLOBAL_INSTRUCTION_SENTINEL":
            findings.append(f"global marker differs: {output!r}")
        home = state / "codex-home"
        if state.is_dir():
            if (home / "AGENTS.override.md").exists():
                findings.append("Codex state contains AGENTS.override.md")
            if not only_fixture_skill(home):
                findings.append("Codex state contains skills beyond fixture-sentinel")
            config = tomllib.loads((home / "config.toml").read_text(encoding="utf-8"))
            allowed = {"model_provider", "service_tier", "model_catalog_json", "model_providers", "projects"}
            if not set(config) <= allowed:
                findings.append(f"Codex config contains extra owners: {sorted(set(config) - allowed)}")

    expected_sha = (workspace / "instructions.sha256").read_text(encoding="utf-8").strip()
    if digest(instruction) != expected_sha:
        findings.append("mounted instruction bytes changed")
    status = subprocess.run(
        ["git", "status", "--porcelain=v1"], cwd=repo, check=True,
        capture_output=True, text=True,
    ).stdout
    if status:
        findings.append(f"discovery probe mutated repository: {status!r}")
    return findings


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("workspace", type=Path)
    parser.add_argument("--agent", required=True, choices=("claude", "codex"))
    args = parser.parse_args()
    findings = check(args.workspace.resolve(), args.agent)
    if findings:
        for finding in findings:
            print(f"FAIL: {finding}")
        return 1
    print(f"PASS: global discovery / {args.agent}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
