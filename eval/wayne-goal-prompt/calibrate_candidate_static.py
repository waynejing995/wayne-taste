#!/usr/bin/env python3
"""Calibrate every independent Wayne Goal Prompt static invariant."""

from __future__ import annotations

import argparse
import shutil
import tempfile
from collections.abc import Callable
from pathlib import Path

from check_candidate_static import BODY_PATTERNS, REQUIRED, RUNTIME_LITERALS, check


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
    mutations.append(("missing-skill", lambda root: (root / "SKILL.md").unlink(), "missing SKILL.md"))
    mutations.append(
        (
            "invalid-frontmatter",
            lambda root: (root / "SKILL.md").write_text("name: broken\n", encoding="utf-8"),
            "invalid frontmatter",
        )
    )
    mutations.append(
        (
            "frontmatter-keys",
            lambda root: replace(root / "SKILL.md", "description:", "summary:"),
            "frontmatter keys differ",
        )
    )
    mutations.append(
        (
            "frontmatter-name",
            lambda root: replace(
                root / "SKILL.md", "name: wayne-goal-prompt", "name: wrong-name"
            ),
            "frontmatter name mismatch",
        )
    )

    for relative in REQUIRED:
        mutations.append(
            (
                f"missing-{relative}",
                lambda root, relative=relative: (root / relative).unlink(),
                f"missing required resource: {relative}",
            )
        )
        mutations.append(
            (
                f"unreferenced-{relative}",
                lambda root, relative=relative: replace(
                    root / "SKILL.md", relative, f"removed/{Path(relative).name}"
                ),
                f"SKILL.md does not reference: {relative}",
            )
        )

    body_replacements = {
        "six-section contract": ("Completion criteria", "Done criteria"),
        "length ceiling": ("4,000 characters", "4,001 characters"),
        "one question": ("ask exactly one Chinese question", "ask one Chinese question"),
        "plan SSoT": ("as the SSoT", "as the source"),
        "real path": ("fake substitute", "shortcut"),
        "confirmation": ("whether the goal is correct", "whether to proceed"),
        "pre-confirm stop": ("do not write a\ngoal file", "avoid writing a\ngoal file"),
        "project-local goal": ("inside the target project", "near the project"),
        "startup failure": ("preserved driver log", "preserved output"),
        "resume": ("same live thread", "same run"),
        "JSONL monitor": ("do not scrape a TUI", "avoid the TUI"),
    }
    if set(body_replacements) != set(BODY_PATTERNS):
        raise AssertionError("body calibration does not cover every pattern")
    for label, (old, new) in body_replacements.items():
        mutations.append(
            (
                f"body-{label}",
                lambda root, old=old, new=new: replace(root / "SKILL.md", old, new),
                f"body omits {label}",
            )
        )

    for heading in ("Inherits", "When to Run"):
        mutations.append(
            (
                f"forbidden-{heading}",
                lambda root, heading=heading: (root / "SKILL.md").write_text(
                    (root / "SKILL.md").read_text(encoding="utf-8")
                    + f"\n## {heading}\n\nCopied content.\n",
                    encoding="utf-8",
                ),
                "copied global/routing section",
            )
        )

    for literal in (
        "thread/start",
        "thread/goal/set",
        "turn/start",
        "thread/inject_items",
        "RTM_NEWADDR",
    ):
        mutations.append(
            (
                f"inline-{literal}",
                lambda root, literal=literal: (root / "SKILL.md").write_text(
                    (root / "SKILL.md").read_text(encoding="utf-8")
                    + f"\nInline protocol: {literal}.\n",
                    encoding="utf-8",
                ),
                f"body inlines runtime protocol detail: {literal}",
            )
        )

    mutations.append(
        (
            "forbidden-dependency",
            lambda root: (root / "forbidden.md").write_text(
                "Invoke gstack for review.\n", encoding="utf-8"
            ),
            "candidate references forbidden dependency",
        )
    )

    for literal in RUNTIME_LITERALS:
        mutations.append(
            (
                f"runtime-{literal}",
                lambda root, literal=literal: replace(
                    root / "references/dispatch-runtime.md", literal, "REMOVED_TOKEN"
                ),
                f"runtime reference omits {literal}",
            )
        )
    for literal in (
        "resume)",
        "WAYNE_DISPATCH_STARTUP_TIMEOUT",
        "control/ready",
        "resume.request",
    ):
        mutations.append(
            (
                f"shell-{literal}",
                lambda root, literal=literal: replace(
                    root / "scripts/codex-dispatch.sh", literal, "REMOVED_TOKEN"
                ),
                f"dispatch shell omits {literal}",
            )
        )
    for literal in (
        "RESUMABLE",
        "resume.request",
        '"status": "active"',
        '"thread/inject_items"',
    ):
        mutations.append(
            (
                f"driver-{literal}",
                lambda root, literal=literal: replace(
                    root / "scripts/codex_goal_driver.py", literal, "REMOVED_TOKEN"
                ),
                f"goal driver omits {literal}",
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

    print(f"PASS: 1 positive and {len(mutations)} independent static mutations")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
