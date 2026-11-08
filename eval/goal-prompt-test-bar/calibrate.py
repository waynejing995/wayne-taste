#!/usr/bin/env python3
"""Calibrate check_trial.py: one valid trial, one mutation per invariant."""

from __future__ import annotations

import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

from check_trial import check

HARNESS = Path(__file__).resolve().parent
TREE = HARNESS.parent / ".runs/goal-prompt-test-bar/candidate-tree"

GOAL = "Goal: x\n\nVerification required before completion:\n- `pytest`\n\nCompletion criteria:\n- y\n"
VALID_FENCED = f"```text\n{GOAL}```\n\n这个 goal 对不对？在哪个 cwd 跑？"
VALID_BARE = f"{GOAL}\n这个 goal 对不对？在哪个 cwd 跑？"


def seed(root: Path) -> Path:
    subprocess.run(
        ["bash", str(HARNESS / "prepare_trial.sh"), "bugfix-stale-reset", str(TREE), str(root)],
        check=True, capture_output=True,
    )
    return root


def trial(base: Path, name: str, text: str | None) -> Path:
    path = base.parent / name
    shutil.copytree(base, path)
    if text is not None:
        (path / "final.md").write_text(text, encoding="utf-8")
    return path


def expect(path: Path, ok: bool, needle: str = "") -> None:
    result = check(path)
    if result["pass"] != ok or (needle and not any(needle in f for f in result["findings"])):
        sys.exit(f"CALIBRATION FAIL {path.name}: {result}")


def main() -> int:
    with tempfile.TemporaryDirectory(prefix="testbar-cal-") as temp:
        base = seed(Path(temp) / "base")
        expect(trial(base, "valid-fenced", VALID_FENCED), True)
        expect(trial(base, "valid-bare", VALID_BARE), True)
        expect(trial(base, "no-response", None), False, "no final response")
        expect(trial(base, "no-goal", "我的建议：先确认目标？"), False, "no goal block")
        long = "```text\n" + GOAL + "- " + "z" * 4000 + "\n```"
        expect(trial(base, "too-long", long), False, "characters")
        mutated = trial(base, "mutated", VALID_FENCED)
        target = next((mutated / "fs/tasks/groups/tasks/scripts").glob("db.py"))
        target.write_text(target.read_text() + "\n# edit\n")
        expect(mutated, False, "mutated the fixture")
        untracked = trial(base, "untracked", VALID_FENCED)
        (untracked / "fs/tasks/groups/tasks/scripts/test_new.py").write_text("x = 1\n")
        expect(untracked, False, "mutated the fixture")
        committed = trial(base, "git-commit", VALID_FENCED)
        subprocess.run(["git", "-C", str(committed / "fs/tasks"), "commit", "-q", "--allow-empty", "-m", "x"], check=True)
        expect(committed, False, "mutated the fixture")
        status = trial(base, "git-status", VALID_FENCED)
        subprocess.run(["git", "-C", str(status / "fs/tasks"), "status", "--porcelain"], check=True, capture_output=True)
        expect(status, True)
    print("PASS: 3 valid shapes (incl. read-only git status), 6 mutations (no response, no goal, >4000, edit, new file, git commit)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
