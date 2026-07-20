#!/usr/bin/env python3
"""Calibrate Plan's deterministic ID and literal proof boundary."""

from __future__ import annotations

import importlib.util
import hashlib
import tempfile
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
VALIDATOR = ROOT / "wayne-plan/scripts/validate_plan.py"
SPEC = importlib.util.spec_from_file_location("validate_plan", VALIDATOR)
assert SPEC and SPEC.loader
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)


SOURCE = """# Feature decisions

## Review resolutions

| ID | Outcome |
|---|---|
| R01 | accepted, future eval only |
| R1 | legacy review label, not a requirement |

## Requirements

- R1: deliver the accepted user-visible behavior.

## Decision Log

| # | Question | Decision | Rationale | Source |
|---|---|---|---|---|
| 1 | Queue | Reuse it | One owner | user |
| 34 | Rollback | Restore old route | Safe reversal | user |
"""


def main() -> int:
    with tempfile.TemporaryDirectory(prefix="wayne-plan-id-contract-") as temp:
        root = Path(temp)
        decision_path = root / "decisions.md"
        spec_path = root / "spec.md"
        decision_path.write_text(SOURCE, encoding="utf-8")
        spec_path.write_text("## Requirements\n\n- R1: deliver the accepted user-visible behavior.\n", encoding="utf-8")
        digest = lambda path: hashlib.sha256(path.read_bytes()).hexdigest()
        sources = {
            "decision_log": ("decisions.md", decision_path),
            "spec": ("spec.md", spec_path),
            "matrix": None,
            "request": None,
        }
        texts = {
            "decisions.md": decision_path.read_text(encoding="utf-8"),
            "spec.md": spec_path.read_text(encoding="utf-8"),
        }
        ledger = {
            "version": 1,
            "sources": {"decision_log": "decisions.md", "spec": "spec.md", "matrix": None, "request": None},
            "source_sha256": {"decisions.md": digest(decision_path), "spec.md": digest(spec_path)},
            "requirements": [{"id": "R1", "source": "spec.md", "exact": "- R1: deliver the accepted user-visible behavior."}],
            "decisions": [
                {"id": "D1", "source": "decisions.md", "exact": "| 1 | Queue | Reuse it | One owner | user |"},
                {"id": "D34", "source": "decisions.md", "exact": "| 34 | Rollback | Restore old route | Safe reversal | user |"},
            ],
            "u_seeds": [],
            "e_contract": {"exact": ""},
        }
        findings = MODULE.Findings()
        MODULE.validate_ledger(ledger, sources, texts, "", {}, findings)
        assert not findings.items, findings.items

        # Semantic classification is intentionally outside this validator. The
        # source-fidelity reviewers, not a heading/regex parser, own completeness.
        incomplete = dict(ledger)
        incomplete["requirements"] = []
        findings = MODULE.Findings()
        MODULE.validate_ledger(incomplete, sources, texts, "", {}, findings)
        assert not findings.items, findings.items

        ledger["requirements"][0]["exact"] = "| R1 | legacy review label, not a requirement |"
        ledger["requirements"][0]["source"] = "decisions.md"
        findings = MODULE.Findings()
        MODULE.validate_ledger(ledger, sources, texts, "", {}, findings)
        assert not findings.items, findings.items

        ledger["requirements"][0]["exact"] = "R1: text absent from every source"
        findings = MODULE.Findings()
        MODULE.validate_ledger(ledger, sources, texts, "", {}, findings)
        assert any(code == "ledger-requirements" for code, _ in findings.items)

    print(
        "PASS: canonical ledger IDs and literal existence enforced; "
        "semantic classification and completeness left to independent AI review"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
