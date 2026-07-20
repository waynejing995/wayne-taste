#!/usr/bin/env python3
"""Calibrate the static Wayne Test Design intent guard."""

from __future__ import annotations

import shutil
import tempfile
from pathlib import Path

from check_candidate_static import check


SKILL = '''---
name: wayne-test-design
description: fixture
---
converged direct request; route unconverged intent upstream.
Map every test-relevant decision. Cite each matched lesson in its row.
If there is an E2E table or `E2E: none — <reason>`, absorb that contract
verbatim exactly once and extend any missing observable paths.
Write `U-SEED (wayne-plan re-authors + locks)` or `U-SEED: none — <reason>`.
Use the next unused `docs/test-matrix/YYYY-MM-DD-NNN-<descriptive-name>-test-matrix.md`.
Pin a fixed host, port, database, cwd, or main worktree in `Env: process`.
```dot
I [label="Scope conflict unresolved?", shape=diamond];
J [label="Invoked by mind-explode?", shape=diamond];
K [label="Write blocked matrix; no plan handoff", shape=doublecircle];
I -> K [label="yes"];
J -> M [label="yes"];
J -> W [label="no"];
```
Write only after approval. Do not auto-advance. Only a
standalone, unblocked run hands the artifact to `wayne-plan`.
Always emit the locked header.
'''

TEMPLATE = '''### U-SEED (wayne-plan re-authors + locks)
| # | Behavior seed | Dimension | Case | Layer | Status |
| ID | User path | Env: process | Env: data | Env: entrypoint | Observable (pass = ?) | Status |
Keep the locked header when there are no E rows.
'''


def seed(root: Path) -> Path:
    (root / "templates").mkdir(parents=True)
    (root / "SKILL.md").write_text(SKILL, encoding="utf-8")
    (root / "templates/test-matrix-template.md").write_text(TEMPLATE, encoding="utf-8")
    return root


def replace(path: Path, old: str, new: str) -> None:
    text = path.read_text(encoding="utf-8")
    if old not in text:
        raise AssertionError(f"missing mutation source: {old!r}")
    path.write_text(text.replace(old, new), encoding="utf-8")


def main() -> int:
    with tempfile.TemporaryDirectory(prefix="test-design-static-") as temp:
        root = Path(temp)
        valid = seed(root / "valid")
        if findings := check(valid):
            raise AssertionError(f"positive escaped: {findings}")
        mutations = [
            ("direct", "converged direct request", "spec only", "converged direct"),
            ("decision", "test-relevant decision", "requirement", "decision coverage"),
            ("lesson", "Cite each matched lesson in its row", "List matched lessons", "row-level KB"),
            ("absorb-none", "E2E table or `E2E: none — <reason>`", "E2E table", "table-or-none"),
            ("absorb-once", "verbatim exactly once", "copy it", "table-or-none"),
            ("extend", "extend any missing observable paths", "keep it", "table-or-none"),
            ("useed-none", "U-SEED: none — <reason>", "No unit rows", "U-SEED"),
            ("path", "YYYY-MM-DD-NNN", "topic", "dated sequence"),
            ("location", "fixed host, port, database, cwd, or main worktree", "runtime", "runtime location"),
            ("blocked-edge", 'I -> K [label="yes"]', 'I -> W [label="yes"]', "blocked terminal"),
            ("return-edge", 'J -> M [label="yes"]', 'J -> W [label="yes"]', "return-only"),
            ("advance", "Do not auto-advance", "Continue", "return-only"),
            ("standalone", 'J -> W [label="no"]', 'J -> W', "plan handoff"),
            ("approval", "Write only after approval", "Write the artifact", "approval-before-write"),
            ("empty-header", "Always emit the locked header", "Omit the locked header when empty", "empty E2E"),
        ]
        template_mutations = [
            ("u-heading", "### U-SEED (wayne-plan re-authors + locks)", "### Unit cases", "U-SEED heading"),
            ("u-owner", "Behavior seed", "Unit", "behavior-seed owner"),
            ("e-header", "Env: process", "Environment", "E2E header"),
        ]
        count = 0
        for label, old, new, needle in mutations:
            trial = root / f"mutation-{label}"
            shutil.copytree(valid, trial)
            replace(trial / "SKILL.md", old, new)
            findings = check(trial)
            if not any(needle in finding for finding in findings):
                raise AssertionError(f"{label} escaped {needle}: {findings}")
            count += 1
        for label, old, new, needle in template_mutations:
            trial = root / f"mutation-{label}"
            shutil.copytree(valid, trial)
            replace(trial / "templates/test-matrix-template.md", old, new)
            findings = check(trial)
            if not any(needle in finding for finding in findings):
                raise AssertionError(f"{label} escaped {needle}: {findings}")
            count += 1
    print(f"PASS: 1 positive lane and {count} independent static mutations")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
