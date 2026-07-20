#!/usr/bin/env python3
"""Seed a 42-node decision DAG with forty resolved decisions."""

from __future__ import annotations

import argparse
from pathlib import Path


def build() -> str:
    decisions = "\n".join(
        f"| {number} | Prerequisite {number} | Resolved choice {number} | approved | user |"
        for number in range(1, 41)
    )
    nodes = []
    for number in range(1, 41):
        parent = "root" if number == 1 else f"N{number - 1}"
        nodes.append(f"| N{number} | {parent} | choice | Resolved prerequisite {number} | resolved | dependency resolved |")
    nodes.extend(
        [
            "| N41 | N40 | choice | Retry exhaustion policy | open | N40 resolved |",
            "| N42 | N41 | choice | Operator recovery after terminal exhaustion | blocked | N41 resolved |",
        ]
    )
    return f"""# Decision Log: Queued Delivery

Status: in-progress

| # | Question | Decision | Rationale | Source |
|---|---|---|---|---|
{decisions}

## Decision DAG

| Node | Parent | Kind | Decision | Status | Opens when |
|---|---|---|---|---|---|
{chr(10).join(nodes)}
"""


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("workspace", type=Path)
    args = parser.parse_args()
    target = args.workspace.resolve() / "repo/docs/decisions/2026-07-20-queued-delivery-decisions.md"
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(build(), encoding="utf-8")
    (args.workspace.resolve() / "long-dag-before.md").write_text(build(), encoding="utf-8")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
