#!/usr/bin/env python3
"""Unblind one round: per-cell judge verdicts, failing rows, and pairwise rank."""

from __future__ import annotations

import json
import sys
from pathlib import Path

ROWS = [f"TB{i}" for i in range(1, 10)]


def main() -> int:
    blind = Path(sys.argv[1])
    mapping = json.loads((blind / "blind-map.json").read_text())
    status = {}
    for line in (blind.parent / blind.name.replace("-blind", "") / "status.txt").read_text().splitlines():
        parts = line.split(" ", 4)
        if len(parts) == 5:
            status[(parts[1], parts[2], parts[3])] = json.loads(parts[4])
    print("| case | agent | side | chars | gate | claude judge | codex judge |")
    print("| --- | --- | --- | ---: | --- | --- | --- |")
    judges = {j: json.loads((blind / f"judge-{j}/verdicts.json").read_text()) for j in ("claude", "codex")}
    wins = {j: [0, 0] for j in judges}
    for tid, m in sorted(mapping.items(), key=lambda kv: (kv[1]["case"], kv[1]["agent"], kv[1]["arm"])):
        gate = status[(m["case"], m["arm"], m["agent"])]
        cells = []
        for j, v in judges.items():
            t = v["trials"].get(tid, {})
            fails = [r for r in ROWS if t.get("rows", {}).get(r, {}).get("verdict") == "fail"]
            cells.append(f'{t.get("verdict", "?")}{" (" + ",".join(fails) + ")" if fails else ""}')
        print(f'| {m["case"]} | {m["agent"]} | {m["arm"]} | {gate["goal_chars"]} | {"pass" if gate["pass"] else "FAIL"} | {cells[0]} | {cells[1]} |')
    for j, v in judges.items():
        for key, order in v.get("rankings", {}).items():
            order = order if isinstance(order, list) else [order]
            arms = [mapping[str(x)]["arm"] for x in order if str(x) in mapping]
            if arms and arms[0] == "candidate":
                wins[j][0] += 1
            wins[j][1] += 1
    print()
    for j, (w, n) in wins.items():
        print(f"{j} judge ranks candidate first in {w}/{n} pairs")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
