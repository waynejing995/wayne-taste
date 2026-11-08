#!/usr/bin/env python3
"""Assemble a blind judge directory: shuffled trial ids, no arm names, plus the
case inputs. Writes <out>/blind-map.json (kept outside /judge) for unblinding."""

from __future__ import annotations

import json
import random
import shutil
import sys
from pathlib import Path

HARNESS = Path(__file__).resolve().parent


def main() -> int:
    round_dir, out = Path(sys.argv[1]).resolve(), Path(sys.argv[2]).resolve()
    judge = out / "judge"
    if judge.exists():
        sys.exit(f"exists: {judge}")
    judge.mkdir(parents=True)
    shutil.copy(HARNESS / "approved-intent.md", judge / "intent.md")
    shutil.copy(HARNESS / "semantic-rubric.md", judge / "rubric.md")
    trials = sorted(
        p for p in round_dir.iterdir()
        if p.is_dir() and not p.name.endswith(".state") and (p / "final.md").exists()
    )
    rng = random.Random(20261105)
    rng.shuffle(trials)
    mapping = {}
    for index, trial in enumerate(trials, 1):
        case, arm, agent = trial.name.split(".")
        tid = f"T{index:02d}"
        mapping[tid] = {"case": case, "arm": arm, "agent": agent}
        dest = judge / "trials" / tid
        dest.mkdir(parents=True)
        (dest / "case.txt").write_text(f"{case} {agent}\n")
        final = trial / "final.md"
        shutil.copy(final, dest / "final.md") if final.is_file() else (dest / "final.md").write_text("")
        case_dir = judge / "cases" / case
        if not case_dir.exists():
            shutil.copytree(HARNESS / "cases" / case, case_dir)
            shutil.copytree(trial / "fs", case_dir / "fs", ignore=shutil.ignore_patterns(".git"))
    (out / "blind-map.json").write_text(json.dumps(mapping, indent=2) + "\n")
    print(f"{len(mapping)} trials -> {judge}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
