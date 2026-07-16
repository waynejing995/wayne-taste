#!/usr/bin/env python3
"""Static oracle for original visual-synthesis contracts."""

from __future__ import annotations

import argparse
from pathlib import Path


CARRIER_FIELDS = {
    "chart": ("chart_type", "x_axis", "y_axis", "series[]", "values[]"),
    "table": ("columns[]", "rows[]", "cells[]", "row_count", "column_count"),
    "flowchart": ("nodes[]", "edges[]", "edge_directions[]", "branch_conditions[]", "loopbacks[]"),
    "diagram": ("components[]", "boundaries[]", "connections[]", "directions[]"),
    "document": ("reading_order[]", "headings[]", "paragraphs[]", "lists[]"),
    "text-block": ("transcript", "line_breaks", "unreadable_ranges[]"),
    "map": ("locations[]", "routes_or_areas[]", "legend", "scale"),
    "equation": ("notation", "variables[]", "operators[]", "layout"),
    "dense-ui": ("controls[]", "values[]", "states[]", "hierarchy[]", "primary_workflow"),
}


def validate(skill: Path) -> list[str]:
    findings: list[str] = []
    main = (skill / "SKILL.md").read_text(encoding="utf-8")
    required_refs = (
        "references/carrier-contracts.md",
        "references/targetable-structure.md",
        "references/synthesis-probes.md",
        "references/compare-methods.md",
        "references/compare_render.py",
        "references/channel_probe.py",
        "references/hidden_probe.py",
    )
    for relative in required_refs:
        if relative not in main:
            findings.append(f"SKILL.md does not route to {relative}")
        if not (skill / relative).is_file():
            findings.append(f"missing required resource: {relative}")

    carrier_path = skill / "references/carrier-contracts.md"
    if carrier_path.is_file():
        carrier = carrier_path.read_text(encoding="utf-8")
        for kind, fields in CARRIER_FIELDS.items():
            row = next((line for line in carrier.splitlines() if f"`{kind}`" in line), "")
            if not row:
                findings.append(f"carrier contract missing {kind}")
                continue
            for field in fields:
                if field not in row:
                    findings.append(f"{kind} contract missing {field}")

    target_path = skill / "references/targetable-structure.md"
    if target_path.is_file():
        target = target_path.read_text(encoding="utf-8")
        for field in (
            "target_ref",
            "identity",
            "geometry",
            "coordinate_space",
            "z_order",
            "occlusion",
            "source_handle",
            "mask_status",
            "confidence",
        ):
            if f"`{field}`" not in target:
                findings.append(f"targetable contract missing {field}")
    return findings


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("skill", type=Path)
    args = parser.parse_args()
    findings = validate(args.skill.resolve())
    if findings:
        for finding in findings:
            print(f"FAIL: {finding}")
        return 1
    print("PASS: original static design contracts")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
