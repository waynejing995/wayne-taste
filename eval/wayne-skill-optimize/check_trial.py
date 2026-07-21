#!/usr/bin/env python3
"""Check only deterministic intent-dossier invariants."""

from __future__ import annotations

import argparse
from pathlib import Path

from dossier_checker import validate


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("workspace", type=Path)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--require-reviews", action="store_true")
    args = parser.parse_args()
    findings = validate(
        args.workspace.resolve(),
        args.output.resolve(),
        require_reviews=args.require_reviews,
    )
    if findings:
        for finding in findings:
            print(f"FAIL: {finding}")
        return 1
    gate = "full dossier + semantic reviews" if args.require_reviews else "deterministic dossier"
    print(f"PASS: {gate}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
