#!/usr/bin/env python3
"""Forge meta-eval: forge ref -> child skills -> fresh downstream agents -> frozen checks -> blind judge packets.

A fixture is a directory with intent.md, fixture.json ({"kind": "rollout"|"request", "cases": [...]}),
cases/, check.py (`check.py <case> <trial_workspace>` -> {"pass", "findings"}), and harness.py for rollouts.

Stages:
  generate    one fresh Claude generator per (arm, fixture, child index); records the generator transcript
  downstream  fresh agents per (child, case, agent, repetition)
  check       frozen fixture checks plus the rollout command audit -> results.json and a pass table
  pack        anonymized per-output judge packets in a directory outside the run
Agents and judges see neutral child IDs only; identity.json maps IDs to arms.
"""

from __future__ import annotations

import argparse
import json
import os
import random
import re
import shutil
import subprocess
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

HARNESS = Path(__file__).resolve().parent
REPO = HARNESS.parents[1]
RUNNER = REPO / "eval/run_isolated_agent.sh"
RUNS = REPO / "eval/.runs/wayne-skill-forge"

# name -> (runner agent, environment)
AGENTS = {
    "claude": ("claude", {"MODEL": "opus", "EFFORT": "high"}),
    "haiku": ("claude", {"MODEL": "haiku", "EFFORT": "high"}),
    "codex": ("codex", {"MODEL": "gpt-6-sol", "EFFORT": "high"}),
}
GENERATOR = "claude"

GENERATE_TASK = """Use the skill at /workspace/forge/SKILL.md to create the skill that /workspace/intent.md describes. The approved intent is complete, so do not ask questions. The user explicitly requests this new skill.

Write the skill directory to /workspace/out/<skill-name>/. This run covers generation only: complete the forge steps up to and including loader validation. The caller runs the behavioral eval separately, so do not launch other agents. Do not install, sync, commit, or publish anything.

Reply with the list of files that you wrote."""

DOWNSTREAM_TASK = {
    "rollout": """Use the skill at /workspace/skills/{skill} to roll out the request file /workspace/rollout/work/cases/{case}.json. Run the request commands from the working directory /workspace/rollout/work.

Write your final report to /workspace/answer.md and return the same text.""",
    "request": """Use the skill at /workspace/skills/{skill} to handle the request in /workspace/request.md.

Write the exact response that you would return to the user to /workspace/answer.md, and return the same text.""",
}

EXIT_PROBE = re.compile(r"""\s*;\s*echo\s+(["']?)[^;|&]*\$\?[^;|&]*\1\s*$""")


def fixture_config(fixture: Path) -> dict[str, object]:
    return json.loads((fixture / "fixture.json").read_text(encoding="utf-8"))


def run_agent(agent: str, workspace: Path, state: Path, timeout: int = 1800) -> dict[str, object]:
    runner_agent, agent_env = AGENTS[agent]
    env = {**os.environ, **agent_env}
    started = time.monotonic()
    try:
        proc = subprocess.run(["bash", str(RUNNER), runner_agent, str(workspace), str(state)], env=env, capture_output=True, text=True, timeout=timeout, check=False)
        code, stderr = proc.returncode, proc.stderr[-2000:]
    except subprocess.TimeoutExpired:
        code, stderr = -1, "timeout"
    meta: dict[str, object] = {"agent": agent, "exit": code, "seconds": round(time.monotonic() - started, 1), "stderr": stderr}
    if runner_agent == "claude":
        result_path = workspace / "claude-result.json"
        data = {}
        if result_path.is_file() and result_path.read_text(encoding="utf-8").strip():
            data = json.loads(result_path.read_text(encoding="utf-8"))
        usage = data.get("modelUsage", {})
        meta.update(is_error=data.get("is_error", True), final=data.get("result", ""), models=list(usage), output_tokens=sum(u.get("outputTokens", 0) for u in usage.values()))
        meta["invalid"] = code != 0 or bool(meta["is_error"])
    else:
        final = workspace / "codex-final.txt"
        meta["final"] = final.read_text(encoding="utf-8") if final.is_file() else ""
        trace = workspace / "codex-trace.log"
        tokens = re.findall(r"tokens used\s*\n?\s*([\d,]+)", trace.read_text(encoding="utf-8", errors="replace")) if trace.is_file() else []
        meta["output_tokens"] = int(tokens[-1].replace(",", "")) if tokens else None
        meta["invalid"] = code != 0 or not meta["final"]
    return meta


def run_with_retry(agent: str, workspace: Path, state: Path, prepare) -> dict[str, object]:
    """Run once; on an invalid trial, keep it as evidence, rebuild the workspace, and rerun once under the same conditions."""
    meta = run_agent(agent, workspace, state)
    if meta["invalid"]:
        shutil.move(str(workspace), str(workspace) + ".invalid1")
        shutil.rmtree(state, ignore_errors=True)
        prepare()
        meta = run_agent(agent, workspace, state)
        meta["retried"] = True
    return meta


def tool_calls(workspace: Path) -> list[dict[str, object]]:
    stream = workspace / "claude-stream.jsonl"
    if not stream.is_file():
        return []
    calls = []
    for line in stream.read_text(encoding="utf-8").splitlines():
        event = json.loads(line)
        if event.get("type") == "assistant":
            calls += [c for c in event["message"]["content"] if c.get("type") == "tool_use"]
    return calls


def tree_words(root: Path) -> dict[str, object]:
    files = sorted(p for p in root.rglob("*") if p.is_file())
    words = {str(p.relative_to(root)): len(p.read_text(encoding="utf-8", errors="replace").split()) for p in files}
    return {"files": words, "skill_md_words": words.get("SKILL.md", 0), "total_words": sum(words.values())}


def generate(run: Path, arms: dict[str, str], fixtures: list[Path], children: int, workers: int) -> None:
    run.mkdir(parents=True, exist_ok=False)
    identity: dict[str, dict[str, str]] = {}
    jobs = []
    for fixture in fixtures:
        slots = [(arm, ref) for arm, ref in sorted(arms.items()) for _ in range(children)]
        ids = [f"c{i:02d}" for i in range(1, len(slots) + 1)]
        random.shuffle(ids)
        for child_id, (arm, ref) in zip(ids, slots):
            name = f"{fixture.name}-{child_id}"
            tree = subprocess.run(["git", "-C", str(REPO), "rev-parse", f"{ref}:wayne-skill-forge"], capture_output=True, text=True, check=True).stdout.strip()
            identity[name] = {"arm": arm, "ref": ref, "forge_tree": tree, "fixture": str(fixture.relative_to(HARNESS))}
            jobs.append((name, fixture, ref))
    (run / "identity.json").write_text(json.dumps(identity, indent=2), encoding="utf-8")

    def one(job: tuple[str, Path, str]) -> tuple[str, dict[str, object]]:
        name, fixture, ref = job
        workspace = run / "gen" / name
        state = run / "state" / f"gen-{name}"

        def prepare() -> None:
            (workspace / "out").mkdir(parents=True)
            archive = subprocess.run(["git", "-C", str(REPO), "archive", ref, "wayne-skill-forge"], capture_output=True, check=True).stdout
            subprocess.run(["tar", "-x", "-C", str(workspace)], input=archive, check=True)
            (workspace / "wayne-skill-forge").rename(workspace / "forge")
            shutil.copy(fixture / "intent.md", workspace / "intent.md")
            (workspace / "task.md").write_text(GENERATE_TASK, encoding="utf-8")

        prepare()
        meta = run_with_retry(GENERATOR, workspace, state, prepare)
        reads = [str(c["input"].get("file_path", "")) for c in tool_calls(workspace) if c.get("name") == "Read"]
        meta["forge_files_read"] = sorted({r.split("/forge/", 1)[1] for r in reads if "/forge/" in r})
        outs = [p for p in (workspace / "out").iterdir() if p.is_dir()] if (workspace / "out").is_dir() else []
        meta["child_dirs"] = [p.name for p in outs]
        if len(outs) == 1:
            shutil.copytree(outs[0], run / "children" / name)
            meta.update(tree_words(run / "children" / name))
            meta["skill_name"] = outs[0].name
        print(f"generated {name}: invalid={meta['invalid']} dirs={meta['child_dirs']} read={meta['forge_files_read']}", flush=True)
        return name, meta

    with ThreadPoolExecutor(max_workers=workers) as pool:
        results = dict(pool.map(one, jobs))
    (run / "generation.json").write_text(json.dumps(results, indent=2, ensure_ascii=False), encoding="utf-8")


def downstream(run: Path, agents: list[str], reps: int, workers: int) -> None:
    generation = json.loads((run / "generation.json").read_text(encoding="utf-8"))
    identity = json.loads((run / "identity.json").read_text(encoding="utf-8"))
    jobs = []
    for name, meta in sorted(generation.items()):
        if "skill_name" not in meta:
            continue
        fixture = HARNESS / identity[name]["fixture"]
        for case in fixture_config(fixture)["cases"]:
            for agent in agents:
                for rep in range(1, reps + 1):
                    jobs.append((name, fixture, meta["skill_name"], case, agent, rep))

    def one(job: tuple[str, Path, str, str, str, int]) -> tuple[str, dict[str, object]]:
        name, fixture, skill, case, agent, rep = job
        trial = f"{name}--{case}--{agent}--r{rep}"
        workspace = run / "trials" / trial
        state = run / "state" / trial
        kind = fixture_config(fixture)["kind"]

        def prepare() -> None:
            shutil.copytree(run / "children" / name, workspace / "skills" / skill)
            if kind == "rollout":
                shutil.copy(fixture / "harness.py", workspace / "harness.py")
                cases = workspace / "rollout/work/cases"
                cases.mkdir(parents=True)
                shutil.copy(fixture / f"cases/{case}.json", cases / f"{case}.json")
            else:
                shutil.copy(fixture / f"cases/{case}.md", workspace / "request.md")
            (workspace / "task.md").write_text(DOWNSTREAM_TASK[kind].format(skill=skill, case=case), encoding="utf-8")

        prepare()
        meta = run_with_retry(agent, workspace, state, prepare)
        print(f"trial {trial}: invalid={meta['invalid']} {meta['seconds']}s", flush=True)
        return trial, meta

    with ThreadPoolExecutor(max_workers=workers) as pool:
        results = dict(pool.map(one, jobs))
    (run / "downstream.json").write_text(json.dumps(results, indent=2, ensure_ascii=False), encoding="utf-8")


def audit_commands(workspace: Path, agent: str, request: dict[str, object]) -> list[str] | None:
    """Findings for harness invocations that differ from the request commands; None if no transcript exists.

    Allowed differences: a leading `cd <dir> &&` and a trailing read-only exit-status probe such as `; echo "exit=$?"`.
    """
    allowed = {str(value) for key, value in request.items() if key.endswith("_command")}
    findings = []
    if AGENTS[agent][0] == "claude":
        if not (workspace / "claude-stream.jsonl").is_file():
            return None
        calls = tool_calls(workspace)
        commands = [str(c["input"].get("command", "")) for c in calls if c.get("name") == "Bash"]
        findings += [f"read the harness source: {c.get('name')} {json.dumps(c['input'])}" for c in calls if c.get("name") in ("Read", "Grep", "Glob") and "harness.py" in json.dumps(c["input"])]
    else:
        trace = workspace / "codex-trace.log"
        if not trace.is_file():
            return None
        commands = [m.group(2) for m in re.finditer(r"""^/bin/bash -lc (['"])(.*)\1 in \S+$""", trace.read_text(encoding="utf-8", errors="replace"), re.MULTILINE)]

    for command in commands:
        if "harness.py" not in (command.strip().splitlines() or [""])[0]:
            continue
        stripped = EXIT_PROBE.sub("", re.sub(r"^\s*cd\s+\S+\s*&&\s*", "", command).strip()).strip()
        if stripped not in allowed:
            findings.append(f"harness invocation differs from the request: {command}")
    return findings


def check(run: Path) -> None:
    trials = json.loads((run / "downstream.json").read_text(encoding="utf-8"))
    identity = json.loads((run / "identity.json").read_text(encoding="utf-8"))
    results = {}
    for trial, meta in sorted(trials.items()):
        name, case, agent, _rep = trial.split("--")
        fixture = HARNESS / identity[name]["fixture"]
        workspace = run / "trials" / trial
        if not (workspace / "answer.md").is_file():
            (workspace / "answer.md").write_text(str(meta.get("final", "")), encoding="utf-8")
        if meta["invalid"]:
            verdict: dict[str, object] = {"pass": None, "findings": ["invalid trial"]}
        else:
            proc = subprocess.run(["python3", str(fixture / "check.py"), case, str(workspace)], capture_output=True, text=True)
            verdict = json.loads(proc.stdout)
            if fixture_config(fixture)["kind"] == "rollout":
                request = json.loads((fixture / f"cases/{case}.json").read_text(encoding="utf-8"))
                audit = audit_commands(workspace, agent, request)
                if audit is None:
                    verdict["findings"].append("unaudited: no command transcript")
                elif audit:
                    verdict = {"pass": False, "findings": verdict["findings"] + audit}
        results[trial] = {"arm": identity[name]["arm"], "fixture": identity[name]["fixture"], "child": name, "case": case, "agent": agent, "pass": verdict["pass"], "findings": verdict["findings"], "seconds": meta["seconds"], "output_tokens": meta.get("output_tokens"), "retried": meta.get("retried", False)}
    (run / "results.json").write_text(json.dumps(results, indent=2, ensure_ascii=False), encoding="utf-8")

    arms = sorted({r["arm"] for r in results.values()})
    rows: dict[tuple[str, str, str], dict[str, list[object]]] = {}
    for r in results.values():
        rows.setdefault((r["fixture"], r["case"], r["agent"]), {}).setdefault(r["arm"], []).append(r["pass"])

    def mark(values: list[object]) -> str:
        invalid = values.count(None)
        return f"{values.count(True)}/{len(values) - invalid}" + (f" (+{invalid} invalid)" if invalid else "")

    print("| Fixture | Case | Agent | " + " | ".join(arms) + " |")
    print("|---|---|---|" + "---|" * len(arms))
    for (fixture_name, case, agent), by_arm in sorted(rows.items()):
        print(f"| {fixture_name} | {case} | {agent} | " + " | ".join(mark(by_arm.get(arm, [])) for arm in arms) + " |")


def pack(run: Path, out: Path) -> None:
    """Write one anonymized judge item per valid trial: intent, input, response, and trace for rollouts."""
    results = json.loads((run / "results.json").read_text(encoding="utf-8"))
    if out.exists():
        shutil.rmtree(out)
    items = [t for t, r in results.items() if r["pass"] is not None]
    random.shuffle(items)
    key = {}
    for index, trial in enumerate(items, 1):
        r = results[trial]
        fixture = HARNESS / r["fixture"]
        item = out / r["fixture"].replace("/", "-") / f"item-{index:03d}"
        item.mkdir(parents=True)
        shutil.copy(fixture / "intent.md", item / "intent.md")
        if (fixture / "judge-rubric.md").is_file():
            shutil.copy(fixture / "judge-rubric.md", item / "judge-rubric.md")
        workspace = run / "trials" / trial
        shutil.copy(workspace / "answer.md", item / "response.md")
        if fixture_config(fixture)["kind"] == "rollout":
            shutil.copy(fixture / f"cases/{r['case']}.json", item / "request.json")
            events = workspace / "rollout/work/state" / r["case"] / "events.jsonl"
            if events.is_file():
                shutil.copy(events, item / "trace.jsonl")
        else:
            shutil.copy(fixture / f"cases/{r['case']}.md", item / "request.md")
        (item / "case.txt").write_text(r["case"] + "\n", encoding="utf-8")
        key[str(item.relative_to(out))] = trial
    (run / "judge-key.json").write_text(json.dumps(key, indent=2), encoding="utf-8")
    print(f"{len(key)} judge items in {out}")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("stage", choices=("generate", "downstream", "check", "pack"))
    parser.add_argument("--run", required=True, help="run name under eval/.runs/wayne-skill-forge/")
    parser.add_argument("--arm", action="append", default=[], metavar="NAME=REF", help="forge arm; repeat for each arm")
    parser.add_argument("--fixture", action="append", default=[], help="fixture directory relative to this harness; repeat")
    parser.add_argument("--children", type=int, default=1, help="child skills per arm and fixture")
    parser.add_argument("--agents", default="claude,codex", help=f"downstream agents, from {','.join(AGENTS)}")
    parser.add_argument("--reps", type=int, default=1, help="downstream repetitions per child, case, and agent")
    parser.add_argument("--out", type=Path, help="judge packet directory for the pack stage")
    parser.add_argument("--workers", type=int, default=8)
    args = parser.parse_args()
    run = RUNS / args.run
    if args.stage == "generate":
        arms = dict(a.split("=", 1) for a in args.arm)
        if len(arms) < 2 or not args.fixture:
            parser.error("generate needs at least two --arm NAME=REF and one --fixture")
        generate(run, arms, [HARNESS / f for f in args.fixture], args.children, args.workers)
    elif args.stage == "downstream":
        agents = args.agents.split(",")
        unknown = set(agents) - set(AGENTS)
        if unknown:
            parser.error(f"unknown agents: {sorted(unknown)}")
        downstream(run, agents, args.reps, args.workers)
    elif args.stage == "check":
        check(run)
    else:
        if not args.out:
            parser.error("pack needs --out")
        pack(run, args.out)


if __name__ == "__main__":
    main()
