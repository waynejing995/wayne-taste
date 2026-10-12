#!/usr/bin/env python3
"""Paired Forge meta-eval: forge ref -> child skill -> fresh downstream agents -> frozen checks.

Stage `generate` makes one child skill per (arm, archetype) with a fresh Claude agent.
Stage `downstream` gives each child to fresh Claude and Codex agents on every case.
Stage `check` runs the frozen checkers and writes results.json plus a summary table.
Agents and checkers see neutral child IDs only; identity.json maps IDs to arms.
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

AGENTS = {
    "claude": {"MODEL": "opus", "EFFORT": "high"},
    "codex": {"MODEL": "gpt-6-sol", "EFFORT": "high"},
}
ARCHETYPES = {
    "procedure": {
        "intent": HARNESS / "procedure/intent.md",
        "cases": ["common", "production-unapproved", "invalid-ticket"],
    },
    "lens": {
        "intent": HARNESS / "archetypes/lens/intent.md",
        "cases": ["supported", "ambiguous", "decline"],
    },
    "router": {
        "intent": HARNESS / "archetypes/router/intent.md",
        "cases": ["runtime-crash", "configuration-drift", "performance-regression", "no-match", "multiple-signals"],
    },
}
ROUTER_EXPECTED = {"no-match": "NO_MATCH", "multiple-signals": "NO_MATCH"}

GENERATE_TASK = """Use the skill at /workspace/forge/SKILL.md to create the skill that /workspace/intent.md describes. The approved intent is complete, so do not ask questions. The user explicitly requests this new skill.

Write the skill directory to /workspace/out/<skill-name>/. This run covers generation only: complete the forge steps up to and including loader validation. The caller runs the behavioral eval separately, so do not launch other agents. Do not install, sync, commit, or publish anything.

Reply with the list of files that you wrote."""

DOWNSTREAM_TASK = {
    "procedure": """Use the skill at /workspace/skills/{skill} to roll out the request file /workspace/rollout/work/cases/{case}.json. Run the request commands from the working directory /workspace/rollout/work.

Write your final report to /workspace/answer.md and return the same text.""",
    "lens": """Use the skill at /workspace/skills/{skill} to handle the request in /workspace/request.md.

Write the exact response that you would return to the user to /workspace/answer.md, and return the same text.""",
    "router": """Use the skill at /workspace/skills/{skill} to handle the request in /workspace/request.md.

Write the exact response that you would return to the user to /workspace/answer.md, and return the same text.""",
}


def run_agent(agent: str, workspace: Path, state: Path, timeout: int = 1800) -> dict[str, object]:
    env = {**os.environ, **AGENTS[agent]}
    started = time.monotonic()
    try:
        proc = subprocess.run(
            ["bash", str(RUNNER), agent, str(workspace), str(state)],
            env=env, capture_output=True, text=True, timeout=timeout, check=False,
        )
        code, stderr = proc.returncode, proc.stderr[-2000:]
    except subprocess.TimeoutExpired:
        code, stderr = -1, "timeout"
    meta: dict[str, object] = {"agent": agent, "exit": code, "seconds": round(time.monotonic() - started, 1), "stderr": stderr}
    if agent == "claude":
        result_path = workspace / "claude-result.json"
        if result_path.is_file():
            data = json.loads(result_path.read_text(encoding="utf-8"))
            meta.update(
                is_error=data.get("is_error"),
                final=data.get("result", ""),
                models=list(data.get("modelUsage", {})),
                output_tokens=sum(u.get("outputTokens", 0) for u in data.get("modelUsage", {}).values()),
            )
        meta["invalid"] = code != 0 or bool(meta.get("is_error", True))
    else:
        final = workspace / "codex-final.txt"
        meta["final"] = final.read_text(encoding="utf-8") if final.is_file() else ""
        trace = workspace / "codex-trace.log"
        tokens = re.findall(r"tokens used\s*\n?\s*([\d,]+)", trace.read_text(encoding="utf-8", errors="replace")) if trace.is_file() else []
        meta["output_tokens"] = int(tokens[-1].replace(",", "")) if tokens else None
        meta["invalid"] = code != 0 or not meta["final"]
    return meta


def run_with_retry(agent: str, workspace: Path, state: Path, prepare) -> dict[str, object]:
    """Run once; on an invalid trial, rebuild the workspace and rerun once under the same conditions."""
    meta = run_agent(agent, workspace, state)
    if meta["invalid"]:
        shutil.move(str(workspace), str(workspace) + ".invalid1")
        shutil.rmtree(state, ignore_errors=True)
        prepare()
        meta = run_agent(agent, workspace, state)
        meta["retried"] = True
    return meta


def tree_words(root: Path) -> dict[str, object]:
    files = sorted(p for p in root.rglob("*") if p.is_file())
    words = {str(p.relative_to(root)): len(p.read_text(encoding="utf-8", errors="replace").split()) for p in files}
    return {"files": words, "skill_md_words": words.get("SKILL.md", 0), "total_words": sum(words.values())}


def generate(run: Path, arms: dict[str, str], workers: int) -> None:
    run.mkdir(parents=True, exist_ok=False)
    identity: dict[str, dict[str, str]] = {}
    jobs = []
    for archetype in ARCHETYPES:
        ids = ["g1", "g2"]
        random.shuffle(ids)
        for child_id, (arm, ref) in zip(ids, sorted(arms.items())):
            tree = subprocess.run(["git", "-C", str(REPO), "rev-parse", f"{ref}:wayne-skill-forge"], capture_output=True, text=True, check=True).stdout.strip()
            identity[f"{archetype}-{child_id}"] = {"arm": arm, "ref": ref, "forge_tree": tree}
            jobs.append((archetype, child_id, ref))
    (run / "identity.json").write_text(json.dumps(identity, indent=2), encoding="utf-8")

    def one(job: tuple[str, str, str]) -> tuple[str, dict[str, object]]:
        archetype, child_id, ref = job
        name = f"{archetype}-{child_id}"
        workspace = run / "gen" / name
        state = run / "state" / f"gen-{name}"

        def prepare() -> None:
            (workspace / "out").mkdir(parents=True)
            archive = subprocess.run(["git", "-C", str(REPO), "archive", ref, "wayne-skill-forge"], capture_output=True, check=True).stdout
            subprocess.run(["tar", "-x", "-C", str(workspace)], input=archive, check=True)
            (workspace / "wayne-skill-forge").rename(workspace / "forge")
            shutil.copy(ARCHETYPES[archetype]["intent"], workspace / "intent.md")
            (workspace / "task.md").write_text(GENERATE_TASK, encoding="utf-8")

        prepare()
        meta = run_with_retry("claude", workspace, state, prepare)
        outs = [p for p in (workspace / "out").iterdir() if p.is_dir()] if (workspace / "out").is_dir() else []
        meta["child_dirs"] = [p.name for p in outs]
        if len(outs) == 1:
            child = run / "children" / name
            shutil.copytree(outs[0], child)
            meta.update(tree_words(child))
            meta["skill_name"] = outs[0].name
        print(f"generated {name}: exit={meta['exit']} invalid={meta['invalid']} dirs={meta['child_dirs']}", flush=True)
        return name, meta

    with ThreadPoolExecutor(max_workers=workers) as pool:
        results = dict(pool.map(one, jobs))
    (run / "generation.json").write_text(json.dumps(results, indent=2, ensure_ascii=False), encoding="utf-8")


def downstream(run: Path, workers: int) -> None:
    generation = json.loads((run / "generation.json").read_text(encoding="utf-8"))
    jobs = []
    for name, meta in sorted(generation.items()):
        if "skill_name" not in meta:
            continue
        archetype = name.split("-")[0]
        for case in ARCHETYPES[archetype]["cases"]:
            for agent in AGENTS:
                jobs.append((name, archetype, meta["skill_name"], case, agent))

    def one(job: tuple[str, str, str, str, str]) -> tuple[str, dict[str, object]]:
        name, archetype, skill, case, agent = job
        trial = f"{name}--{case}--{agent}"
        workspace = run / "trials" / trial
        state = run / "state" / trial

        def prepare() -> None:
            shutil.copytree(run / "children" / name, workspace / "skills" / skill)
            if archetype == "procedure":
                shutil.copy(HARNESS / "procedure/harness.py", workspace / "harness.py")
                cases = workspace / "rollout/work/cases"
                cases.mkdir(parents=True)
                shutil.copy(HARNESS / f"procedure/cases/{case}.json", cases / f"{case}.json")
            else:
                shutil.copy(HARNESS / f"archetypes/{archetype}/cases/{case}.md", workspace / "request.md")
            (workspace / "task.md").write_text(DOWNSTREAM_TASK[archetype].format(skill=skill, case=case), encoding="utf-8")

        prepare()
        meta = run_with_retry(agent, workspace, state, prepare)
        print(f"trial {trial}: exit={meta['exit']} invalid={meta['invalid']} {meta['seconds']}s", flush=True)
        return trial, meta

    with ThreadPoolExecutor(max_workers=workers) as pool:
        results = dict(pool.map(one, jobs))
    (run / "downstream.json").write_text(json.dumps(results, indent=2, ensure_ascii=False), encoding="utf-8")


def check(run: Path) -> None:
    trials = json.loads((run / "downstream.json").read_text(encoding="utf-8"))
    identity = json.loads((run / "identity.json").read_text(encoding="utf-8"))
    results = {}
    for trial, meta in sorted(trials.items()):
        name, case, agent = trial.split("--")
        archetype = name.split("-")[0]
        workspace = run / "trials" / trial
        answer_path = workspace / "answer.md"
        if not answer_path.is_file():
            answer_path = workspace / "answer-from-final.md"
            answer_path.write_text(str(meta.get("final", "")), encoding="utf-8")
        if meta["invalid"]:
            verdict = {"pass": None, "findings": ["invalid trial"]}
        elif archetype == "procedure":
            request = json.loads((HARNESS / f"procedure/cases/{case}.json").read_text(encoding="utf-8"))
            state_dir = request["validate_command"].split()[-1]
            events = workspace / "rollout/work" / state_dir / "events.jsonl"
            if events.is_file():
                proc = subprocess.run(["python3", str(HARNESS / "procedure/check_trace.py"), case, str(events)], capture_output=True, text=True)
                verdict = json.loads(proc.stdout)
            else:
                verdict = {"pass": False, "findings": ["no events.jsonl: no harness command ran"]}
        elif archetype == "lens":
            proc = subprocess.run(["python3", str(HARNESS / "archetypes/lens/check_output.py"), str(answer_path), str(HARNESS / f"archetypes/lens/cases/{case}.md"), "--case", case], capture_output=True, text=True)
            verdict = json.loads(proc.stdout)
        else:
            expected = ROUTER_EXPECTED.get(case, case)
            proc = subprocess.run(["python3", str(HARNESS / "archetypes/router/check_output.py"), str(answer_path), "--expected", expected], capture_output=True, text=True)
            verdict = json.loads(proc.stdout)
        results[trial] = {"arm": identity[name]["arm"], "archetype": archetype, "case": case, "agent": agent, "pass": verdict["pass"], "findings": verdict["findings"], "seconds": meta["seconds"], "output_tokens": meta.get("output_tokens"), "retried": meta.get("retried", False)}
    (run / "results.json").write_text(json.dumps(results, indent=2, ensure_ascii=False), encoding="utf-8")

    def mark(value: object) -> str:
        return {True: "pass", False: "FAIL", None: "invalid"}[value]  # type: ignore[index]

    print("| Archetype | Case | Agent | Control | Candidate |")
    print("|---|---|---|---|---|")
    rows: dict[tuple[str, str, str], dict[str, str]] = {}
    for r in results.values():
        rows.setdefault((r["archetype"], r["case"], r["agent"]), {})[r["arm"]] = mark(r["pass"])
    for (archetype, case, agent), arms in sorted(rows.items()):
        print(f"| {archetype} | {case} | {agent} | {arms.get('control', '-')} | {arms.get('candidate', '-')} |")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("stage", choices=("generate", "downstream", "check"))
    parser.add_argument("--run", required=True, help="run name under eval/.runs/wayne-skill-forge/")
    parser.add_argument("--control", default=None, help="git ref of the control forge")
    parser.add_argument("--candidate", default=None, help="git ref of the candidate forge")
    parser.add_argument("--workers", type=int, default=8)
    args = parser.parse_args()
    run = RUNS / args.run
    if args.stage == "generate":
        if not (args.control and args.candidate):
            parser.error("generate needs --control and --candidate")
        generate(run, {"control": args.control, "candidate": args.candidate}, args.workers)
    elif args.stage == "downstream":
        downstream(run, args.workers)
    else:
        check(run)


if __name__ == "__main__":
    main()
