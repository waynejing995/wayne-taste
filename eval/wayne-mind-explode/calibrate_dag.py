#!/usr/bin/env python3
"""Calibrate the decision-DAG iteration checker."""

from __future__ import annotations

import json
import shutil
import tempfile
from pathlib import Path

import decision_log
from check_dag_iteration import check, check_long
from seed_long_dag import LOG_RELATIVE as LONG_LOG_RELATIVE
from seed_long_dag import records as long_records

TOPIC = "queued-delivery"
LOG_RELATIVE = f".wayne/runs/{TOPIC}/decision-log.jsonl"

OWNER_FACT = "Dispatcher is the sole lifecycle owner"
TOPOLOGY = "Delivery topology: inline or queue"
SEMANTICS = "Delivery guarantee and idempotency ownership"
RETRY = "Retry policy and attempt budget"
EXHAUSTION = "Retry exhaustion and operator recovery"


def node(identifier, parent, kind, description, status, opens_when, resolved_by):
    return {
        "type": "node",
        "id": identifier,
        "parent": parent,
        "kind": kind,
        "decision": description,
        "status": status,
        "opens_when": opens_when,
        "resolved_by": resolved_by,
    }


def log(
    states: tuple[str, str, str],
    decisions: list[str],
    *,
    owner_fact: str = OWNER_FACT,
    semantics: str = SEMANTICS,
    offset: int = 0,
) -> str:
    """One turn snapshot. `offset` shifts node numbering without changing meaning."""

    def name(number: int) -> str:
        return f"N{number + offset}"

    records: list[dict[str, object]] = [
        {
            "type": "meta",
            "topic": TOPIC,
            "status": "in-progress",
            "spec": None,
            "test_matrix": None,
            "frontier_locked": False,
            "written_spec_approved": False,
            "approved_spec_sha256": None,
        }
    ]
    for index, value in enumerate(decisions, 1):
        records.append(
            {
                "type": "decision",
                "id": f"D{index}",
                "question": "Choice",
                "decision": value,
                "rationale": "accepted",
                "consequences": None,
                "supersedes": [],
                "source": "codebase" if index == 1 else "user",
                "reference": "docs/architecture.md" if index == 1 else None,
            }
        )
    resolved_by = {
        "topology": "D2" if states[0] == "resolved" else None,
        "semantics": "D3" if states[1] == "resolved" else None,
        "retry": "D4" if states[2] == "resolved" else None,
    }
    records.extend(
        [
            node(name(1), None, "fact", owner_fact, "resolved", None, "D1"),
            node(name(2), None, "choice", TOPOLOGY, states[0], None, resolved_by["topology"]),
            node(name(3), name(2), "choice", semantics, states[1], f"{name(2)} = queue", resolved_by["semantics"]),
            node(name(4), name(3), "choice", RETRY, states[2], f"{name(3)} = at-least-once", resolved_by["retry"]),
            node(name(5), name(4), "choice", EXHAUSTION, "blocked", f"{name(4)} resolved", None),
        ]
    )
    return decision_log.dump(records)


def write(path: Path, text: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding="utf-8")


SNAPSHOTS = {
    1: (("open", "blocked", "blocked"), ["Dispatcher remains sole lifecycle owner"]),
    2: (
        ("resolved", "open", "blocked"),
        ["Dispatcher remains sole lifecycle owner", "Use existing queue"],
    ),
    3: (
        ("resolved", "resolved", "open"),
        [
            "Dispatcher remains sole lifecycle owner",
            "Use existing queue",
            "At-least-once; Dispatcher owns idempotency",
        ],
    ),
}
OUTPUTS = {
    1: "我的推荐：使用现有队列以隔离故障。你选择哪种投递拓扑？",
    2: "My recommendation: use at-least-once delivery with Dispatcher idempotency. Which delivery guarantee do you want?",
    3: "My recommendation: bounded exponential backoff. Which retry policy and attempt budget should apply?",
}


def seed(root: Path, **kwargs: object) -> Path:
    (root / "repo").mkdir(parents=True)
    # The real trial always carries the fixture repository; a codebase decision
    # references a file in it, so the calibration must provide one too.
    write(root / "repo/docs/architecture.md", "# Architecture\n\nDispatcher owns delivery.\n")
    for turn in (1, 2, 3):
        states, decisions = SNAPSHOTS[turn]
        write(root / f"turn-{turn}-decision-log.jsonl", log(states, decisions, **kwargs))
        write(root / f"turn-{turn}-output.txt", OUTPUTS[turn])
        write(root / f"turn-{turn}-output.json", json.dumps({"result": OUTPUTS[turn]}) + "\n")
    return root


def seed_long(root: Path) -> Path:
    write(root / "repo/docs/architecture.md", "# Architecture\n\nDispatcher owns delivery.\n")
    records = long_records()
    records.append(
        {
            "type": "decision",
            "id": "D41",
            "question": "Retry exhaustion policy",
            "decision": "Mark FAILED and retain payload for manual replay",
            "rationale": "accepted",
            "consequences": "Retained payloads cost storage",
            "supersedes": [],
            "source": "user",
            "reference": None,
        }
    )
    for record in records:
        if record.get("type") != "node":
            continue
        if record["id"] == "N41":
            record["status"] = "resolved"
            record["resolved_by"] = "D41"
        elif record["id"] == "N42":
            record["status"] = "open"
    write(root / "repo" / LONG_LOG_RELATIVE, decision_log.dump(records))
    output = "My recommendation: expose manual replay with an operator audit trail. Which operator recovery path should we use?"
    write(root / "codex-final.txt", output)
    write(root / "claude-result.json", json.dumps({"result": output}) + "\n")
    return root


def replace(path: Path, old: str, new: str) -> None:
    text = path.read_text(encoding="utf-8")
    if old not in text:
        raise AssertionError(f"mutation source missing: {old!r}")
    path.write_text(text.replace(old, new), encoding="utf-8")


def expect(root: Path, needle: str, label: str) -> None:
    findings = check(root, "codex")
    if not any(needle in finding for finding in findings):
        raise AssertionError(f"{label} escaped {needle!r}: {findings}")


def main() -> int:
    with tempfile.TemporaryDirectory(prefix="mind-dag-cal-") as temp:
        base = seed(Path(temp) / "valid")
        if findings := check(base, "codex"):
            raise AssertionError(f"positive Codex: {findings}")
        if findings := check(base, "claude"):
            raise AssertionError(f"positive Claude: {findings}")

        # The checker matches node meaning, not node numbering or wording.
        renumbered = seed(Path(temp) / "renumbered", offset=10)
        if findings := check(renumbered, "codex"):
            raise AssertionError(f"positive renumbered Codex: {findings}")
        if findings := check(renumbered, "claude"):
            raise AssertionError(f"positive renumbered Claude: {findings}")

        for label, wording in (
            ("owner-first", "Sole owner of delivery lifecycle state"),
            ("ownership-noun", "Existing delivery lifecycle ownership and persistence constraints"),
        ):
            variant = seed(Path(temp) / label, owner_fact=wording)
            if findings := check(variant, "codex"):
                raise AssertionError(f"positive {label} Codex: {findings}")
            if findings := check(variant, "claude"):
                raise AssertionError(f"positive {label} Claude: {findings}")

        rephrased = seed(
            Path(temp) / "rephrased",
            semantics="Queued delivery guarantee and idempotency ownership",
        )
        if findings := check(rephrased, "codex"):
            raise AssertionError(f"positive rephrased Codex: {findings}")

        mutations = [
            ("no-dag", 1, '{"type":"node"', '{"type":"note"', "has no DAG nodes"),
            (
                "root-not-resolved",
                2,
                f'"decision":"{TOPOLOGY}","status":"resolved","opens_when":null,"resolved_by":"D2"',
                f'"decision":"{TOPOLOGY}","status":"open","opens_when":null,"resolved_by":null',
                "topology status",
            ),
            (
                "child-not-open",
                2,
                f'"decision":"{SEMANTICS}","status":"open"',
                f'"decision":"{SEMANTICS}","status":"blocked"',
                "semantics status",
            ),
            (
                "premature-child",
                2,
                f'"decision":"{SEMANTICS}","status":"open","opens_when":"N2 = queue","resolved_by":null',
                f'"decision":"{SEMANTICS}","status":"resolved","opens_when":"N2 = queue","resolved_by":"D2"',
                "semantics status",
            ),
            (
                "final-escape",
                3,
                f'"decision":"{RETRY}","status":"open","opens_when":"N3 = at-least-once","resolved_by":null',
                f'"decision":"{RETRY}","status":"resolved","opens_when":"N3 = at-least-once","resolved_by":"D3"',
                "retry status",
            ),
            (
                "status-payload",
                2,
                f'"decision":"{TOPOLOGY}","status":"resolved"',
                f'"decision":"{TOPOLOGY}","status":"resolved: queue"',
                "invalid status",
            ),
            ("no-question", 2, "Which delivery guarantee do you want?", "Delivery guarantee recorded.", "asks 0 questions"),
            ("two-questions", 3, "Which retry policy and attempt budget should apply?", "Which retry policy should apply? What attempt budget?", "asks 2 questions"),
            ("no-recommendation", 1, "我的推荐：", "选项：", "omits recommendation"),
        ]
        for label, turn, old, new, needle in mutations:
            trial = Path(temp) / label
            shutil.copytree(base, trial)
            target = trial / (
                f"turn-{turn}-decision-log.jsonl" if old.startswith(('{', '"')) else f"turn-{turn}-output.txt"
            )
            replace(target, old, new)
            expect(trial, needle, label)

        batched = Path(temp) / "batched"
        shutil.copytree(base, batched)
        extra = decision_log.dumps(
            {
                "type": "decision",
                "id": "D3",
                "question": "Choice",
                "decision": "Guessed semantics",
                "rationale": "accepted",
                "consequences": None,
                "supersedes": [],
                "source": "default",
                "reference": None,
            }
        )
        path = batched / "turn-2-decision-log.jsonl"
        lines = path.read_text(encoding="utf-8").splitlines()
        index = max(i for i, line in enumerate(lines) if '"type":"decision"' in line)
        lines.insert(index + 1, extra)
        path.write_text("".join(f"{line}\n" for line in lines), encoding="utf-8")
        expect(batched, "appended 2 decisions", "batched decisions")

        wrong_kind = Path(temp) / "wrong-fact-kind"
        shutil.copytree(base, wrong_kind)
        replace(
            wrong_kind / "turn-1-decision-log.jsonl",
            f'"kind":"fact","decision":"{OWNER_FACT}"',
            f'"kind":"choice","decision":"{OWNER_FACT}"',
        )
        expect(wrong_kind, "0 owner_fact nodes", "fact kind")

        ungrounded = Path(temp) / "ungrounded-fact"
        shutil.copytree(base, ungrounded)
        replace(
            ungrounded / "turn-1-decision-log.jsonl",
            '"source":"codebase"',
            '"source":"user"',
        )
        expect(ungrounded, "auto-resolved ownership fact evidence", "fact evidence")

        advanced = Path(temp) / "advanced"
        shutil.copytree(base, advanced)
        write(advanced / "repo/docs/specs/premature.md", "# Premature\n")
        expect(advanced, "advanced to forbidden artifact", "premature artifact")

        long = seed_long(Path(temp) / "long-valid")
        if findings := check_long(long, "codex"):
            raise AssertionError(f"positive long Codex: {findings}")
        if findings := check_long(long, "claude"):
            raise AssertionError(f"positive long Claude: {findings}")

        long_mutations = [
            (
                "long-blocked",
                '"id":"N42","parent":"N41","kind":"choice","decision":"Operator recovery after terminal exhaustion","status":"open"',
                '"id":"N42","parent":"N41","kind":"choice","decision":"Operator recovery after terminal exhaustion","status":"blocked"',
                "N42 status",
            ),
            ("long-missing-node", '"id":"N20"', '"id":"N99"', "node set drifted"),
            ("long-missing-decision", '"id":"D41"', '"id":"D99"', "not exactly 1..41"),
        ]
        for label, old, new, needle in long_mutations:
            trial = Path(temp) / label
            shutil.copytree(long, trial)
            replace(trial / "repo" / LONG_LOG_RELATIVE, old, new)
            findings = check_long(trial, "codex")
            if not any(needle in finding for finding in findings):
                raise AssertionError(f"{label} escaped {needle!r}: {findings}")

        escaped = Path(temp) / "long-escaped"
        shutil.copytree(long, escaped)
        write(escaped / "codex-final.txt", "My recommendation: approve the design. Design-approved; spec ready.")
        findings = check_long(escaped, "codex")
        if not any("escaped early" in finding for finding in findings):
            raise AssertionError(f"long early escape not detected: {findings}")

        long_two_questions = Path(temp) / "long-two-questions"
        shutil.copytree(long, long_two_questions)
        write(long_two_questions / "codex-final.txt", "My recommendation: manual replay. Which recovery path? What audit scope?")
        findings = check_long(long_two_questions, "codex")
        if not any("exactly one" in finding for finding in findings):
            raise AssertionError(f"long multiple questions not detected: {findings}")

        print(
            "PASS: DAG observations cover 11 lanes and 18 mutations; "
            "semantic verdict remains AI_REVIEW_REQUIRED"
        )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
