#!/usr/bin/env python3
from __future__ import annotations

import json
import subprocess
import sys
import tempfile
from pathlib import Path


ROOT = Path(__file__).resolve().parent


def run(command: list[str]) -> tuple[bool, list[str], str]:
    completed = subprocess.run(command, check=False, capture_output=True, text=True)
    try:
        result = json.loads(completed.stdout)
        return bool(result["pass"]), list(result.get("findings", [])), result.get("route", "")
    except (json.JSONDecodeError, KeyError):
        print(f"Failed to parse output: {completed.stdout}", file=sys.stderr)
        print(f"Stderr: {completed.stderr}", file=sys.stderr)
        raise


def write_answer(workspace: Path, text: str) -> None:
    workspace.mkdir(parents=True, exist_ok=True)
    (workspace / "answer.md").write_text(text, encoding="utf-8")


def main() -> None:
    failures: list[str] = []
    print("| Checker case | Expected | Observed |")
    print("|---|---|---|")
    with tempfile.TemporaryDirectory(prefix="router-v2-calibration-") as temp:
        temp_root = Path(temp)
        checker = ROOT / "check.py"

        # Valid cases: (case_name, body)
        valid_cases = [
            ("resource-saturation-strong", "ROUTE: resource-saturation\nPLAYBOOK: resource-saturation\n## Resource snapshot\nX\n## Saturation cause\nX\n## Remediation check\nX\n"),
            ("latency-and-deployment-precedence", "ROUTE: latency-trace\nPLAYBOOK: latency-trace\n## Latency evidence\nX\n## Baseline SLO\nX\n## Trace target\nX\n"),
            ("error-spike-strong", "ROUTE: error-spike\nPLAYBOOK: error-spike\n## Error evidence\nX\n## Log pattern\nX\n## Regression check\nX\n"),
            ("deployment-rollout-only", "ROUTE: deployment-rollout\nPLAYBOOK: deployment-rollout\n## Change evidence\nX\n## Rollout scope\nX\n## Rollback plan\nX\n"),
            ("zero-signal", "ROUTE: NO_MATCH\n## Missing discriminator\n- Provide latency or error baseline data.\n"),
            ("zero-signal", "ROUTE: NO_MATCH\n## Missing discriminator\n-  Provide baseline (double space after marker).\n"),
            ("zero-signal", "ROUTE: NO_MATCH\n## Missing discriminator\n- Request evidence.\n\n## Notes\n- Later bullet should not count.\n"),
            ("zero-signal", "ROUTE: NO_MATCH\n## Missing discriminator\n- Request evidence.\n**Context notes**\n"),
            ("zero-signal", "ROUTE: NO_MATCH\n## Missing discriminator\n1. Provide error rate baseline over the last 7 days.\n"),
        ]

        # Invalid cases: (case_name, body, description)
        invalid_cases = [
            ("resource-saturation-strong", "ROUTE: error-spike\nPLAYBOOK: error-spike\n## Error evidence\nX\n## Log pattern\nX\n## Regression check\nX\n", "wrong-route"),
            ("resource-saturation-strong", "ROUTE: resource-saturation\nROUTE: latency-trace\nPLAYBOOK: resource-saturation\n## Resource snapshot\nX\n## Saturation cause\nX\n## Remediation check\nX\n", "two-markers"),
            ("resource-saturation-strong", "ROUTE: resource-saturation\nPLAYBOOK: resource-saturation\n## Resource snapshot\nX\n## Baseline SLO\nX\n## Remediation check\nX\n", "foreign-section"),
            ("zero-signal", "ROUTE: NO_MATCH\nPLAYBOOK: resource-saturation\n## Missing discriminator\n- Provide latency or error baseline data.\n", "no-match-has-playbook"),
            ("zero-signal", "ROUTE: NO_MATCH\n## Missing discriminator\n- Provide latency data.\n- Provide error baseline.\n", "multiple-bullets"),
            ("latency-and-deployment-precedence", "ROUTE: latency-trace\nPLAYBOOK: latency-trace\n## Latency evidence\nX\n## Baseline SLO\nX\n", "missing-section"),
            ("latency-and-deployment-precedence", "ROUTE: latency-trace\nPLAYBOOK: latency-trace\n## Baseline SLO\nX\n## Latency evidence\nX\n## Trace target\nX\n", "wrong-order"),
            ("zero-signal", "ROUTE: NO_MATCH\n## Missing discriminator\n", "no-discriminator"),
            ("resource-saturation-strong", "Analysis follows.\nROUTE: resource-saturation\nPLAYBOOK: resource-saturation\n## Resource snapshot\nX\n## Saturation cause\nX\n## Remediation check\nX\n", "preamble"),
            ("latency-and-deployment-precedence", "ROUTE: latency-trace\nAnalysis follows.\nPLAYBOOK: latency-trace\n## Latency evidence\nX\n## Baseline SLO\nX\n## Trace target\nX\n", "playbook-after-preamble"),
            ("resource-saturation-strong", "ROUTE: resource-saturation\nPLAYBOOK: resource-saturation\n## Resource snapshot\nSee **Change evidence** section below.\n## Saturation cause\nX\n## Remediation check\nX\n", "inline-foreign-section-bold"),
            ("zero-signal", "ROUTE: NO_MATCH\n## Missing discriminator\n- First item.\n* Second item.\n", "two-bullets-invalid"),
            ("zero-signal", "ROUTE: NO_MATCH\n## Missing discriminator\n## Notes\n- These bullets should not count.\n", "empty-discriminator-notes-bullets"),
        ]

        for case, body in valid_cases:
            ws = temp_root / f"valid-{case}"
            write_answer(ws, body)
            observed, findings, route = run([
                sys.executable, str(checker), case, str(ws),
            ])
            ok = observed == True
            print(f"| {case}-valid | pass | {'pass' if observed else 'fail'} |")
            if not ok:
                print(f"  Findings: {findings}", file=sys.stderr)
                failures.append(f"{case}-valid")

        for case, body, desc in invalid_cases:
            ws = temp_root / f"invalid-{desc}"
            write_answer(ws, body)
            observed, findings, route = run([
                sys.executable, str(checker), case, str(ws),
            ])
            ok = observed == False
            print(f"| invalid-{desc} | fail | {'pass' if not observed else 'fail'} |")
            if not ok:
                print(f"  Findings: {findings}", file=sys.stderr)
                failures.append(f"invalid-{desc}")

    if failures:
        print(f"\ncalibration failures: {failures}", file=sys.stderr)
        raise SystemExit(1)
    else:
        print("\nAll calibration checks passed!")


if __name__ == "__main__":
    main()
