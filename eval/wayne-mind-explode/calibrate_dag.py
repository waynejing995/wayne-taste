#!/usr/bin/env python3
"""Calibrate the decision-DAG iteration checker."""

from __future__ import annotations

import json
import shutil
import tempfile
from pathlib import Path

from check_dag_iteration import check, check_long
from seed_long_dag import build as build_long


def log(states: tuple[str, str, str], decisions: list[str]) -> str:
    rows = "\n".join(
        f"| {index} | Choice | {value} | accepted | {'codebase' if index == 1 else 'user'} |"
        for index, value in enumerate(decisions, 1)
    )
    return f"""# Decision Log

Status: in-progress

| # | Question | Decision | Rationale | Source |
|---|---|---|---|---|
{rows}

## Decision DAG

| Node | Parent | Kind | Decision | Status | Opens when |
|---|---|---|---|---|---|
| N0 | root | fact | Dispatcher is the sole lifecycle owner | resolved | repository evidence |
| N1 | root | choice | Delivery topology: inline or queue | {states[0]} | start |
| N2 | N1 | choice | Delivery guarantee and idempotency ownership | {states[1]} | N1 = queue |
| N3 | N2 | choice | Retry policy and attempt budget | {states[2]} | N2 = at-least-once |
| N4 | N3 | choice | Retry exhaustion and operator recovery | blocked | N3 resolved |
"""


def write(path: Path, text: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding="utf-8")


def seed(root: Path) -> Path:
    (root / "repo").mkdir(parents=True)
    snapshots = {
        1: log(("open", "blocked", "blocked"), ["Dispatcher remains sole lifecycle owner"]),
        2: log(("resolved", "open", "blocked"), ["Dispatcher remains sole lifecycle owner", "Use existing queue"]),
        3: log(("resolved", "resolved", "open"), ["Dispatcher remains sole lifecycle owner", "Use existing queue", "At-least-once; Dispatcher owns idempotency"]),
    }
    outputs = {
        1: "我的推荐：使用现有队列以隔离故障。你选择哪种投递拓扑？",
        2: "My recommendation: use at-least-once delivery with Dispatcher idempotency. Which delivery guarantee do you want?",
        3: "My recommendation: bounded exponential backoff. Which retry policy and attempt budget should apply?",
    }
    for turn in (1, 2, 3):
        write(root / f"turn-{turn}-decision-log.md", snapshots[turn])
        write(root / f"turn-{turn}-output.txt", outputs[turn])
        write(root / f"turn-{turn}-output.json", json.dumps({"result": outputs[turn]}) + "\n")
    return root


def seed_long(root: Path) -> Path:
    text = build_long()
    row40 = "| 40 | Prerequisite 40 | Resolved choice 40 | approved | user |"
    row41 = "| 41 | Retry exhaustion policy | Mark FAILED and retain payload for manual replay | accepted | user |"
    text = text.replace(row40, f"{row40}\n{row41}")
    text = text.replace("| N41 | N40 | choice | Retry exhaustion policy | open |", "| N41 | N40 | choice | Retry exhaustion policy | resolved |")
    text = text.replace("| N42 | N41 | choice | Operator recovery after terminal exhaustion | blocked |", "| N42 | N41 | choice | Operator recovery after terminal exhaustion | open |")
    write(root / "repo/docs/decisions/2026-07-20-queued-delivery-decisions.md", text)
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

        alternate_ids = Path(temp) / "alternate-ids"
        shutil.copytree(base, alternate_ids)
        for path in alternate_ids.glob("turn-*-decision-log.md"):
            for old, new in (("N0", "F1"), ("N1", "C1"), ("N2", "C2"), ("N3", "C3"), ("N4", "C4")):
                replace(path, old, new)
            replace(
                path,
                "Dispatcher is the sole lifecycle owner",
                "Existing delivery-state ownership and durability boundary",
            )
            replace(
                path,
                "Delivery guarantee and idempotency ownership",
                "Queued delivery guarantee and idempotency ownership",
            )
        if findings := check(alternate_ids, "codex"):
            raise AssertionError(f"positive alternate-ID Codex: {findings}")
        if findings := check(alternate_ids, "claude"):
            raise AssertionError(f"positive alternate-ID Claude: {findings}")

        for label, wording in (
            ("owner-first", "Sole owner of delivery lifecycle state"),
            ("ownership-noun", "Existing delivery lifecycle ownership and persistence constraints"),
        ):
            variant = Path(temp) / label
            shutil.copytree(base, variant)
            for path in variant.glob("turn-*-decision-log.md"):
                replace(path, "Dispatcher is the sole lifecycle owner", wording)
            if findings := check(variant, "codex"):
                raise AssertionError(f"positive {label} Codex: {findings}")
            if findings := check(variant, "claude"):
                raise AssertionError(f"positive {label} Claude: {findings}")

        mutations = [
            ("no-dag", 1, "## Decision DAG", "## Notes", "omits Decision DAG"),
            ("root-not-resolved", 2, "| N1 | root | choice | Delivery topology: inline or queue | resolved |", "| N1 | root | choice | Delivery topology: inline or queue | open |", "topology status"),
            ("child-not-open", 2, "| N2 | N1 | choice | Delivery guarantee and idempotency ownership | open |", "| N2 | N1 | choice | Delivery guarantee and idempotency ownership | blocked |", "semantics status"),
            ("premature-child", 2, "| N2 | N1 | choice | Delivery guarantee and idempotency ownership | open |", "| N2 | N1 | choice | Delivery guarantee and idempotency ownership | resolved |", "semantics status"),
            ("final-escape", 3, "| N3 | N2 | choice | Retry policy and attempt budget | open |", "| N3 | N2 | choice | Retry policy and attempt budget | resolved |", "retry status"),
            ("status-payload", 2, "| N1 | root | choice | Delivery topology: inline or queue | resolved |", "| N1 | root | choice | Delivery topology: inline or queue | resolved: queue |", "topology status"),
            ("no-question", 2, "Which delivery guarantee do you want?", "Delivery guarantee recorded.", "asks 0 questions"),
            ("two-questions", 3, "Which retry policy and attempt budget should apply?", "Which retry policy should apply? What attempt budget?", "asks 2 questions"),
            ("no-recommendation", 1, "我的推荐：", "选项：", "omits recommendation"),
        ]
        for label, turn, old, new, needle in mutations:
            trial = Path(temp) / label
            shutil.copytree(base, trial)
            target = trial / (f"turn-{turn}-decision-log.md" if old.startswith("|") or old.startswith("##") else f"turn-{turn}-output.txt")
            replace(target, old, new)
            expect(trial, needle, label)

        batched = Path(temp) / "batched"
        shutil.copytree(base, batched)
        path = batched / "turn-2-decision-log.md"
        replace(path, "| 2 | Choice | Use existing queue | accepted | user |", "| 2 | Choice | Use existing queue | accepted | user |\n| 3 | Choice | Guessed semantics | accepted | default |")
        expect(batched, "appended 2 decisions", "batched decisions")

        wrong_kind = Path(temp) / "wrong-fact-kind"
        shutil.copytree(base, wrong_kind)
        replace(wrong_kind / "turn-1-decision-log.md", "| N0 | root | fact |", "| N0 | root | choice |")
        expect(wrong_kind, "0 owner_fact nodes", "fact kind")

        ungrounded = Path(temp) / "ungrounded-fact"
        shutil.copytree(base, ungrounded)
        replace(ungrounded / "turn-1-decision-log.md", "| accepted | codebase |", "| accepted | user |")
        expect(ungrounded, "auto-resolved ownership fact evidence", "fact evidence")

        advanced = Path(temp) / "advanced"
        shutil.copytree(base, advanced)
        write(advanced / "repo/docs/specs/premature-design.md", "# Premature\n")
        expect(advanced, "advanced to forbidden artifact", "premature artifact")

        long = seed_long(Path(temp) / "long-valid")
        if findings := check_long(long, "codex"):
            raise AssertionError(f"positive long Codex: {findings}")
        if findings := check_long(long, "claude"):
            raise AssertionError(f"positive long Claude: {findings}")

        long_mutations = [
            ("long-blocked", "| N42 | N41 | choice | Operator recovery after terminal exhaustion | open |", "| N42 | N41 | choice | Operator recovery after terminal exhaustion | blocked |", "N42 status"),
            ("long-missing-node", "| N20 | N19 | choice | Resolved prerequisite 20 | resolved | dependency resolved |\n", "", "node set drifted"),
            ("long-missing-decision", "| 41 | Retry exhaustion policy | Mark FAILED and retain payload for manual replay | accepted | user |\n", "", "not exactly 1..41"),
        ]
        for label, old, new, needle in long_mutations:
            trial = Path(temp) / label
            shutil.copytree(long, trial)
            path = next((trial / "repo/docs/decisions").glob("*-decisions.md"))
            replace(path, old, new)
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

    print("PASS: 10 positive lanes and 18 independent DAG mutations")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
