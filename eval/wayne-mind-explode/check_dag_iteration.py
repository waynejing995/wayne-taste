#!/usr/bin/env python3
"""Check three-turn decision-DAG expansion and exit behavior."""

from __future__ import annotations

import argparse
import json
import re
from pathlib import Path


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


def output_text(workspace: Path, provider: str, turn: int) -> str:
    suffix = "json" if provider == "claude" else "txt"
    path = workspace / f"turn-{turn}-output.{suffix}"
    text = path.read_text(encoding="utf-8")
    if provider == "claude":
        value = json.loads(text)
        return str(value.get("result", "")).strip()
    return text.strip()


def decision_count(text: str) -> int:
    return sum(1 for line in text.splitlines() if re.match(r"^\|\s*\d+\s*\|", line))


def dag(text: str, findings: list[str], turn: int) -> dict[str, str]:
    if "## Decision DAG" not in text:
        findings.append(f"turn {turn} decision log omits Decision DAG")
        return {}
    rows: list[tuple[str, str, str]] = []
    in_dag = False
    for line in text.splitlines():
        if line.strip() == "## Decision DAG":
            in_dag = True
            continue
        if in_dag and line.startswith("## "):
            break
        if not in_dag or not line.startswith("|"):
            continue
        cells = [cell.strip() for cell in line.strip().strip("|").split("|")]
        if cells[0].casefold() == "node" or all(set(cell) <= {"-", ":"} for cell in cells):
            continue
        if len(cells) != 6:
            findings.append(f"turn {turn} DAG row has {len(cells)} cells")
            continue
        rows.append((cells[2].casefold(), cells[3], cells[4].casefold()))
    state: dict[str, str] = {}
    for name, pattern in TERMS.items():
        expected_kind = "fact" if name == "owner_fact" else "choice"
        semantic_matches = [(kind, status) for kind, decision, status in rows if pattern.search(decision)]
        matches = [(kind, status) for kind, status in semantic_matches if kind == expected_kind]
        if len(matches) != 1:
            if len(semantic_matches) == 1:
                findings.append(
                    f"turn {turn} {name} kind={semantic_matches[0][0]!r}, expected={expected_kind!r}"
                )
            else:
                findings.append(f"turn {turn} DAG has {len(matches)} {name} nodes")
        else:
            kind, status = matches[0]
            state[name] = status
    return state


def check(workspace: Path, provider: str) -> list[str]:
    findings: list[str] = []
    logs: dict[int, str] = {}
    for turn in (1, 2, 3):
        path = workspace / f"turn-{turn}-decision-log.md"
        if not path.is_file():
            findings.append(f"turn {turn} decision-log snapshot missing")
            continue
        logs[turn] = path.read_text(encoding="utf-8")
        if not re.search(r"^\|\s*\d+\s*\|[^\n]*Dispatcher[^\n]*\|\s*(?:codebase|constraint)\s*\|$", logs[turn], re.MULTILINE | re.IGNORECASE):
            findings.append(f"turn {turn} omits auto-resolved ownership fact evidence")
        state = dag(logs[turn], findings, turn)
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
        counts = [decision_count(logs[turn]) for turn in (1, 2, 3)]
        if counts[1] != counts[0] + 1:
            findings.append(f"turn 2 appended {counts[1] - counts[0]} decisions instead of one")
        if counts[2] != counts[1] + 1:
            findings.append(f"turn 3 appended {counts[2] - counts[1]} decisions instead of one")

    repo = workspace / "repo"
    forbidden = (
        "docs/specs/**/*.md", "docs/test-matrix/**/*.md", "docs/reviews/**/*.md",
        "docs/plans/**/*.md", ".wayne/checkpoints/**/*.md",
    )
    for pattern in forbidden:
        if any(path.is_file() for path in repo.glob(pattern)):
            findings.append(f"DAG iteration advanced to forbidden artifact: {pattern}")
    return findings


def check_long(workspace: Path, provider: str) -> list[str]:
    findings: list[str] = []
    matches = sorted((workspace / "repo/docs/decisions").glob("*-decisions.md"))
    if len(matches) != 1:
        return [f"long DAG expected one decision log; found={len(matches)}"]
    text = matches[0].read_text(encoding="utf-8")
    identifiers = [
        int(match.group(1))
        for line in text.splitlines()
        if (match := re.match(r"^\|\s*D?(\d+)\s*\|", line, re.IGNORECASE))
    ]
    if identifiers != list(range(1, 42)):
        findings.append(f"long DAG decisions are not exactly 1..41: {identifiers}")
    if not re.search(r"^\|\s*D?41\s*\|[^\n]*(?:FAILED|manual replay)[^\n]*\|\s*user\s*\|$", text, re.MULTILINE | re.IGNORECASE):
        findings.append("long DAG omits the user's N41 exhaustion decision")
    nodes: dict[int, str] = {}
    for line in text.splitlines():
        match = re.match(r"^\|\s*N(\d+)\s*\|", line, re.IGNORECASE)
        if not match:
            continue
        cells = [cell.strip() for cell in line.strip().strip("|").split("|")]
        if len(cells) == 6:
            nodes[int(match.group(1))] = cells[4].casefold()
    if set(nodes) != set(range(1, 43)):
        findings.append(f"long DAG node set drifted: {sorted(nodes)}")
    if any(nodes.get(number) != "resolved" for number in range(1, 42)):
        findings.append("long DAG did not preserve N1..N41 as resolved")
    if nodes.get(42) != "open":
        findings.append(f"long DAG N42 status={nodes.get(42)!r}, expected='open'")

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
    for pattern in ("docs/specs/**/*.md", "docs/test-matrix/**/*.md", "docs/reviews/**/*.md", ".wayne/checkpoints/**/*.md"):
        if any(path.is_file() for path in (workspace / "repo").glob(pattern)):
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
    if findings:
        for finding in findings:
            print(f"FAIL: {finding}")
        return 1
    print(f"PASS: decision DAG iteration ({args.mode}) / {args.provider}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
