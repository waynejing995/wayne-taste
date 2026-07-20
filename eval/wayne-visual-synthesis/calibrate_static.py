#!/usr/bin/env python3
"""Calibrate each independent original-contract static check."""

from __future__ import annotations

import argparse
import shutil
import tempfile
from pathlib import Path

from check_static import CARRIER_FIELDS, SHORT_CIRCUIT_ROWS, validate


REQUIRED_REFS = (
    "references/carrier-contracts.md",
    "references/targetable-structure.md",
    "references/synthesis-probes.md",
    "references/compare-methods.md",
    "references/compare_render.py",
    "references/channel_probe.py",
    "references/hidden_probe.py",
)
TARGET_FIELDS = (
    "target_ref",
    "identity",
    "geometry",
    "coordinate_space",
    "z_order",
    "occlusion",
    "source_handle",
    "mask_status",
    "confidence",
)


def replace_once(path: Path, old: str, new: str) -> None:
    text = path.read_text(encoding="utf-8")
    if old not in text:
        raise AssertionError(f"calibration token not found: {old} in {path}")
    path.write_text(text.replace(old, new, 1), encoding="utf-8")


def replace_all(path: Path, old: str, new: str) -> None:
    text = path.read_text(encoding="utf-8")
    if old not in text:
        raise AssertionError(f"calibration token not found: {old} in {path}")
    path.write_text(text.replace(old, new), encoding="utf-8")


def replace_in_carrier_row(path: Path, kind: str, field: str, new: str) -> None:
    lines = path.read_text(encoding="utf-8").splitlines(keepends=True)
    for index, line in enumerate(lines):
        if f"`{kind}`" in line and field in line:
            lines[index] = line.replace(field, new, 1)
            path.write_text("".join(lines), encoding="utf-8")
            return
    raise AssertionError(f"calibration token not found: {kind}.{field} in {path}")


def expect_finding(skill: Path, needle: str) -> None:
    findings = validate(skill)
    if not any(needle in finding for finding in findings):
        raise AssertionError(f"mutation missed {needle!r}: {findings}")


def clone(control: Path, root: Path, name: str) -> Path:
    target = root / name
    shutil.copytree(control, target)
    return target


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("skill", type=Path)
    args = parser.parse_args()
    control = args.skill.resolve()

    mutations = 0
    with tempfile.TemporaryDirectory(prefix="visual-static-calibration-") as temp:
        root = Path(temp)
        positive = clone(control, root, "positive")
        skill_text = (positive / "SKILL.md").read_text(encoding="utf-8")
        (positive / "SKILL.md").write_text(
            skill_text + "\n[Render floor](references/compare_render.py)\n",
            encoding="utf-8",
        )
        findings = validate(positive)
        if findings:
            raise AssertionError(f"positive static fixture failed: {findings}")

        for index, relative in enumerate(REQUIRED_REFS):
            trial = clone(positive, root, f"ref-{index}")
            replace_all(trial / "SKILL.md", relative, f"missing/{index}")
            expect_finding(trial, f"does not route to {relative}")
            mutations += 1

        for kind, fields in CARRIER_FIELDS.items():
            for index, field in enumerate(fields):
                trial = clone(positive, root, f"carrier-{kind}-{index}")
                replace_in_carrier_row(
                    trial / "references/carrier-contracts.md",
                    kind,
                    field,
                    f"MISSING_{index}",
                )
                expect_finding(trial, f"{kind} contract missing {field}")
                mutations += 1

        for index, field in enumerate(TARGET_FIELDS):
            trial = clone(positive, root, f"target-{index}")
            replace_once(trial / "references/targetable-structure.md", f"`{field}`", f"`MISSING_{index}`")
            expect_finding(trial, f"targetable contract missing {field}")
            mutations += 1

        for index, signal in enumerate(SHORT_CIRCUIT_ROWS):
            trial = clone(positive, root, f"short-circuit-{index}")
            replace_once(
                trial / "references/compare-methods.md",
                f"| {signal} |",
                f"| DRIFTED {index} |",
            )
            expect_finding(trial, f"compare short-circuit row drifted: {signal}")
            mutations += 1

    print(f"PASS: calibrated static control and {mutations} independent mutations")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
