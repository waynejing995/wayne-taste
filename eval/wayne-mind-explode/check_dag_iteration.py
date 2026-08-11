#!/usr/bin/env python3
"""Check three-turn decision-DAG expansion and exit behavior."""

from __future__ import annotations

import argparse
import json
import re
from pathlib import Path

import decision_log


QUESTION = re.compile(r"[?？]")
RECOMMENDATION = re.compile(r"My recommendation:|我的建议|我的推荐|建议|推荐", re.IGNORECASE)
TERMS = {
    "owner_fact": re.compile(
        r"(?=.*(?:delivery|lifecycle))(?=.*own)",
        re.IGNORECASE,
    ),
    "topology": re.compile(r"topolog|inline|拓扑|内联", re.IGNORECASE),
    "semantics": re.compile(r"guarantee|at-least|exactly|idempoten|duplicate|投递语义|幂等|重复", re.IGNORECASE),
    "retry": re.compile(r"retry policy|attempt budget|backoff|重试策略|尝试次数|退避", re.IGNORECASE),
    "exhaustion": re.compile(r"exhaust|dead.?letter|operator recovery|terminal failure|耗尽|死信|人工恢复|最终失败", re.IGNORECASE),
}
EXPECTED = {
    1: {"owner_fact": "resolved", "topology": "open", "semantics": "blocked", "retry": "blocked", "exhaustion": "blocked"},
    2: {"owner_fact": "resolved", "topology": "resolved", "semantics": "open", "retry": "blocked", "exhaustion": "blocked"},
    3: {"owner_fact": "resolved", "topology": "resolved", "semantics": "resolved", "retry": "open", "exhaustion": "blocked"},
}
OWNERSHIP_EVIDENCE = re.compile(r"dispatcher", re.IGNORECASE)
GROUNDED_SOURCES = {"codebase", "constraint"}


def output_text(workspace: Path, provider: str, turn: int) -> str:
    suffix = "json" if provider == "claude" else "txt"
    path = workspace / f"turn-{turn}-output.{suffix}"
    text = path.read_text(encoding="utf-8")
    if provider == "claude":
        value = json.loads(text)
        return str(value.get("result", "")).strip()
    return text.strip()


def dag(log: decision_log.Log, findings: list[str], turn: int) -> dict[str, str]:
    if not log.nodes:
        findings.append(f"turn {turn} decision log has no DAG nodes")
        return {}
    state: dict[str, str] = {}
    for name, pattern in TERMS.items():
        expected_kind = "fact" if name == "owner_fact" else "choice"
        semantic_matches = [
            (str(record.get("kind", "")).casefold(), str(record.get("status", "")).casefold())
            for record in log.nodes.values()
            if pattern.search(str(record.get("decision", "")))
        ]
        matches = [item for item in semantic_matches if item[0] == expected_kind]
        if len(matches) != 1:
            if len(semantic_matches) == 1:
                findings.append(
                    f"turn {turn} {name} kind={semantic_matches[0][0]!r}, expected={expected_kind!r}"
                )
            else:
                findings.append(f"turn {turn} DAG has {len(matches)} {name} nodes")
        else:
            state[name] = matches[0][1]
    return state


def check(workspace: Path, provider: str) -> list[str]:
    findings: list[str] = []
    logs: dict[int, decision_log.Log] = {}
    for turn in (1, 2, 3):
        path = workspace / f"turn-{turn}-decision-log.jsonl"
        if not path.is_file():
            findings.append(f"turn {turn} decision-log snapshot missing")
            continue
        turn_findings: list[str] = []
        log = decision_log.load(path, turn_findings)
        findings.extend(f"turn {turn} {finding}" for finding in turn_findings)
        logs[turn] = log

        if not any(
            OWNERSHIP_EVIDENCE.search(str(record.get("decision", "")))
            and str(record.get("source", "")).casefold() in GROUNDED_SOURCES
            for record in log.decisions
        ):
            findings.append(f"turn {turn} omits auto-resolved ownership fact evidence")

        state = dag(log, findings, turn)
        for node, expected in EXPECTED[turn].items():
            if state.get(node) != expected:
                findings.append(
                    f"turn {turn} {node} status={state.get(node)!r}, expected={expected!r}"
                )
        output = output_text(workspace, provider, turn)
        questions = len(QUESTION.findall(output))
        if questions != 1:
            findings.append(f"turn {turn} asks {questions} questions instead of one")
        if not RECOMMENDATION.search(output):
            findings.append(f"turn {turn} omits recommendation")
        if not TERMS[("topology", "semantics", "retry")[turn - 1]].search(output):
            findings.append(f"turn {turn} asks about the wrong DAG node")
        if re.search(r"design[- ]approved|spec ready|设计完成|设计已批准", output, re.IGNORECASE):
            findings.append(f"turn {turn} exits the DAG before its frontier is empty")

    if set(logs) == {1, 2, 3}:
        counts = [len(logs[turn].decisions) for turn in (1, 2, 3)]
        if counts[1] != counts[0] + 1:
            findings.append(f"turn 2 appended {counts[1] - counts[0]} decisions instead of one")
        if counts[2] != counts[1] + 1:
            findings.append(f"turn 3 appended {counts[2] - counts[1]} decisions instead of one")

    repo = workspace / "repo"
    forbidden = (
        "docs/specs/**/*.md", "docs/plans/**/*.md",
        ".wayne/runs/*/test-matrix.md", ".wayne/runs/*/review-*.md", ".wayne/runs/*/spec.md",
        ".wayne/checkpoints/**/*.md",
    )
    for pattern in forbidden:
        if any(path.is_file() for path in repo.glob(pattern)):
            findings.append(f"DAG iteration advanced to forbidden artifact: {pattern}")
    return findings


def check_long(workspace: Path, provider: str) -> list[str]:
    findings: list[str] = []
    repo = workspace / "repo"
    log = decision_log.read(repo, findings)
    if log is None:
        return findings

    identifiers = log.decision_ids()
    if identifiers != list(range(1, 42)):
        findings.append(f"long DAG decisions are not exactly 1..41: {identifiers}")
    exhaustion = [
        record for record in log.decisions
        if str(record.get("id")) == "D41"
        and str(record.get("source", "")).casefold() == "user"
        and re.search(r"FAILED|manual replay", str(record.get("decision", "")), re.IGNORECASE)
    ]
    if not exhaustion:
        findings.append("long DAG omits the user's N41 exhaustion decision")

    nodes = log.node_numbers()
    if set(nodes) != set(range(1, 43)):
        findings.append(f"long DAG node set drifted: {sorted(nodes)}")
    unresolved = [
        number for number in range(1, 42)
        if str(nodes.get(number, {}).get("status", "")).casefold() != "resolved"
    ]
    if unresolved:
        findings.append("long DAG did not preserve N1..N41 as resolved")
    tail = str(nodes.get(42, {}).get("status", "")).casefold() or None
    if tail != "open":
        findings.append(f"long DAG N42 status={tail!r}, expected='open'")

    path = workspace / ("claude-result.json" if provider == "claude" else "codex-final.txt")
    if provider == "claude":
        output = str(json.loads(path.read_text(encoding="utf-8")).get("result", "")).strip()
    else:
        output = path.read_text(encoding="utf-8").strip()
    if len(QUESTION.findall(output)) != 1:
        findings.append("long DAG must ask exactly one next question")
    if not RECOMMENDATION.search(output):
        findings.append("long DAG next question omits recommendation")
    if not re.search(r"operator|manual|replay|recovery|人工|恢复|重放", output, re.IGNORECASE):
        findings.append("long DAG asks about the wrong next node")
    if re.search(r"design[- ]approved|spec ready|设计完成|设计已批准", output, re.IGNORECASE):
        findings.append("long DAG escaped early after forty decisions")
    for pattern in (
        "docs/specs/**/*.md", ".wayne/runs/*/test-matrix.md",
        ".wayne/runs/*/review-*.md", ".wayne/checkpoints/**/*.md",
    ):
        if any(path.is_file() for path in repo.glob(pattern)):
            findings.append(f"long DAG advanced to forbidden artifact: {pattern}")
    return findings


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("workspace", type=Path)
    parser.add_argument("--provider", choices=("claude", "codex"), required=True)
    parser.add_argument("--mode", choices=("three-turn", "long"), default="three-turn")
    args = parser.parse_args()
    findings = (
        check(args.workspace.resolve(), args.provider)
        if args.mode == "three-turn"
        else check_long(args.workspace.resolve(), args.provider)
    )
    result = {
        "semantic_verdict": "AI_REVIEW_REQUIRED",
        "mode": args.mode,
        "provider": args.provider,
        "observations": findings,
    }
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
