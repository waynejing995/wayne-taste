#!/usr/bin/env python3
"""Seed a 42-node decision DAG with forty resolved decisions."""

from __future__ import annotations

import argparse
from pathlib import Path

import decision_log

TOPIC = "queued-delivery"
LOG_RELATIVE = f".wayne/runs/{TOPIC}/decision-log.jsonl"


def records() -> list[dict[str, object]]:
    out: list[dict[str, object]] = [
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
    for number in range(1, 41):
        out.append(
            {
                "type": "decision",
                "id": f"D{number}",
                "question": f"Prerequisite {number}",
                "decision": f"Resolved choice {number}",
                "rationale": "approved",
                "consequences": None,
                "supersedes": [],
                "source": "user",
                "reference": None,
            }
        )
    for number in range(1, 41):
        out.append(
            {
                "type": "node",
                "id": f"N{number}",
                "parent": None if number == 1 else f"N{number - 1}",
                "kind": "choice",
                "decision": f"Resolved prerequisite {number}",
                "status": "resolved",
                "opens_when": None if number == 1 else "dependency resolved",
                "resolved_by": f"D{number}",
            }
        )
    out.append(
        {
            "type": "node",
            "id": "N41",
            "parent": "N40",
            "kind": "choice",
            "decision": "Retry exhaustion policy",
            "status": "open",
            "opens_when": "N40 resolved",
            "resolved_by": None,
        }
    )
    out.append(
        {
            "type": "node",
            "id": "N42",
            "parent": "N41",
            "kind": "choice",
            "decision": "Operator recovery after terminal exhaustion",
            "status": "blocked",
            "opens_when": "N41 resolved",
            "resolved_by": None,
        }
    )
    return out


def build() -> str:
    return decision_log.dump(records())


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("workspace", type=Path)
    args = parser.parse_args()
    workspace = args.workspace.resolve()
    target = workspace / "repo" / LOG_RELATIVE
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(build(), encoding="utf-8")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
