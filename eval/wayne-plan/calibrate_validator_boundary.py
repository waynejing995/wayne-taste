#!/usr/bin/env python3
"""Calibrate Plan's bounded E owner and structural/semantic checker boundary."""

from __future__ import annotations

import importlib.util
import tempfile
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
VALIDATOR = ROOT / "wayne-plan/scripts/validate_plan.py"
SPEC = importlib.util.spec_from_file_location("validate_plan", VALIDATOR)
assert SPEC and SPEC.loader
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)


REAL = """## E2E Verification Contract

| ID | Status | User path | Expected observable result |
|---|---|---|---|
| E1 | ⬜ | Submit once. | One record is visible. |
"""
DECOY = """## Review notes

| ID | Outcome |
|---|---|
| E99 | old review label only |
"""


def extract(text: str) -> tuple[str, list[str], list[tuple[str, str]]]:
    findings = MODULE.Findings()
    block, ids = MODULE.extract_e_contract(text, findings)
    return block, ids, findings.items


def main() -> int:
    block, ids, findings = extract(DECOY + "\n" + REAL)
    assert not findings, findings
    assert ids == ["E1"] and "E99" not in block

    _, _, findings = extract(DECOY)
    assert any(code == "source-e-section" for code, _ in findings), findings

    none = """## Layer 2: E2E Verification Contract

E2E: none — internal refactor with no user-observable path
"""
    block, ids, findings = extract(DECOY + "\n" + none)
    assert not findings and ids == [] and block.startswith("E2E: none —")

    with tempfile.TemporaryDirectory(prefix="plan-surface-boundary-") as temp:
        root = Path(temp)
        source = root / "module.py"
        source.write_text(
            "# the planned symbol is intentionally not defined yet\n", encoding="utf-8"
        )
        findings_obj = MODULE.Findings()
        MODULE.surface_file_exists(
            root, ("module.py", "Future.symbol"), findings_obj, "surface"
        )
        assert not findings_obj.items, findings_obj.items

        missing = MODULE.Findings()
        MODULE.surface_file_exists(
            root, ("missing.py", "Future.symbol"), missing, "surface"
        )
        assert any(code == "surface" for code, _ in missing.items), missing.items

    print(
        "PASS: bounded E owner and structural surface boundary; "
        "prose semantics stay with AI review"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
