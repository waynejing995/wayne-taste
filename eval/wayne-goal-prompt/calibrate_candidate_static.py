#!/usr/bin/env python3
"""Calibrate only the Wayne Goal Prompt machine-resource boundary."""

from __future__ import annotations

import argparse
import shutil
import tempfile
from collections.abc import Callable
from pathlib import Path

from check_candidate_static import REQUIRED, check


Mutation = Callable[[Path], None]


def replace(path: Path, old: str, new: str) -> None:
    text = path.read_text(encoding="utf-8")
    if old not in text:
        raise AssertionError(f"calibration source omits {old!r}: {path}")
    path.write_text(text.replace(old, new), encoding="utf-8")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("candidate", type=Path)
    args = parser.parse_args()
    source = args.candidate.resolve()
    findings = check(source)
    if findings:
        raise AssertionError(f"positive fixture failed: {findings}")

    mutations: list[tuple[str, Mutation, str]] = []
    mutations.append(
        ("missing-skill", lambda root: (root / "SKILL.md").unlink(), "missing SKILL.md")
    )
    for relative in REQUIRED:
        mutations.append(
            (
                f"missing-{relative}",
                lambda root, relative=relative: (root / relative).unlink(),
                f"missing required resource: {relative}",
            )
        )
    with tempfile.TemporaryDirectory(prefix="goal-prompt-static-") as temp:
        base = Path(temp)
        for index, (label, mutate, needle) in enumerate(mutations, start=1):
            trial = base / f"{index:02d}-{label.replace('/', '-')}"
            shutil.copytree(source, trial)
            mutate(trial)
            trial_findings = check(trial)
            if not any(needle in finding for finding in trial_findings):
                raise AssertionError(f"{label} escaped {needle!r}: {trial_findings}")

    with tempfile.TemporaryDirectory(prefix="goal-prompt-paraphrase-") as temp:
        paraphrase = Path(temp) / "candidate"
        shutil.copytree(source, paraphrase)
        replace(
            paraphrase / "SKILL.md",
            "whether the goal is correct",
            "whether the goal matches the intent",
        )
        if check(paraphrase):
            raise AssertionError("a prose paraphrase became a machine-contract failure")

    print(
        f"PASS: 1 positive, {len(mutations)} machine-resource mutations, "
        "and 1 prose paraphrase"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
