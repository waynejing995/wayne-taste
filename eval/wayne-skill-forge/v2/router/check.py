from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path


ROUTES = {
    "latency-trace": ("Latency evidence", "Baseline SLO", "Trace target"),
    "resource-saturation": ("Resource snapshot", "Saturation cause", "Remediation check"),
    "error-spike": ("Error evidence", "Log pattern", "Regression check"),
    "deployment-rollout": ("Change evidence", "Rollout scope", "Rollback plan"),
}

# Expected route for each case
EXPECTED = {
    "resource-saturation-strong": "resource-saturation",
    "resource-and-deployment-precedence": "resource-saturation",
    "latency-and-deployment-precedence": "latency-trace",
    "error-spike-strong": "error-spike",
    "deployment-rollout-only": "deployment-rollout",
    "latency-weak-only": "NO_MATCH",
    "zero-signal": "NO_MATCH",
    "latency-and-error-forbidden-pair": "NO_MATCH",
}


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("case", choices=list(EXPECTED.keys()), help="Case name")
    parser.add_argument("trial_workspace", type=Path, help="Trial workspace directory")
    args = parser.parse_args()

    expected_route = EXPECTED[args.case]
    answer_file = args.trial_workspace / "answer.md"
    
    if not answer_file.exists():
        result = {
            "pass": False,
            "route": None,
            "findings": [f"answer.md not found in {args.trial_workspace}"],
        }
        print(json.dumps(result, ensure_ascii=False, indent=2))
        raise SystemExit(1)

    text = answer_file.read_text(encoding="utf-8")
    findings: list[str] = []
    lines = [line.strip() for line in text.splitlines() if line.strip()]
    first = lines[0] if lines else ""
    expected_first = f"ROUTE: {expected_route}"
    if first != expected_first:
        findings.append(f"first non-empty line must equal {expected_first}, got {repr(first)}")

    # For matched routes, second line must be PLAYBOOK marker
    second = lines[1] if len(lines) > 1 else ""
    expected_second = f"PLAYBOOK: {expected_route}"
    if expected_route != "NO_MATCH" and second != expected_second:
        findings.append(f"second non-empty line must equal {expected_second}, got {repr(second)}")

    route_lines = [line for line in lines if line.startswith("ROUTE:")]
    all_route_sections = {section for sections in ROUTES.values() for section in sections}

    if len(route_lines) != 1:
        findings.append(f"expected one ROUTE marker, found {len(route_lines)}")

    # Extract headings
    headings = [line[3:].strip() for line in lines if line.startswith("## ")]

    if expected_route == "NO_MATCH":
        # NO_MATCH checks
        if "PLAYBOOK:" in text:
            findings.append("NO_MATCH must not contain PLAYBOOK:")
        if headings.count("Missing discriminator") != 1:
            findings.append(f"NO_MATCH must have exactly one Missing discriminator heading; found={headings.count('Missing discriminator')}")
        foreign = sorted(section for section in all_route_sections if section in text)
        if foreign:
            findings.append(f"NO_MATCH leaked playbook sections: {foreign}")
        missing_body = text.split("## Missing discriminator", 1)[1] if "## Missing discriminator" in text else ""
        # Truncate at next heading if present
        next_heading = re.search(r"^##", missing_body, re.MULTILINE)
        if next_heading:
            missing_body = missing_body[:next_heading.start()]
        # Count bullets with any valid Markdown marker: - * + or numbered (digit.)
        bullets = [line for line in missing_body.splitlines() if re.match(r"^\s*([-*+]|\d+[.)])\s+\S", line)]
        if len(bullets) != 1:
            findings.append(f"NO_MATCH must request exactly one discriminator bullet; found={len(bullets)}")
    else:
        # Matched route checks
        expected_playbook = f"PLAYBOOK: {expected_route}"
        playbook_lines = [line for line in lines if line.startswith("PLAYBOOK:")]
        if playbook_lines != [expected_playbook]:
            findings.append(f"playbook marker mismatch: expected {[expected_playbook]}, got {playbook_lines}")
        expected_sections = list(ROUTES[expected_route])
        if headings != expected_sections:
            findings.append(f"selected playbook headings mismatch: expected {expected_sections}, got {headings}")
        foreign = sorted(
            section
            for section in all_route_sections - set(expected_sections)
            if section in text
        )
        if foreign:
            findings.append(f"foreign playbook sections: {foreign}")

    result = {"pass": not findings, "route": expected_route, "findings": findings}
    print(json.dumps(result, ensure_ascii=False, indent=2))
    if findings:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
