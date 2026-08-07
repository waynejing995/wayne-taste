from __future__ import annotations

import argparse
import json
import re
from pathlib import Path


ROUTES = {
    "runtime-crash": ("Crash evidence", "Reproduction boundary", "Next probe"),
    "configuration-drift": ("Drift evidence", "Source of truth", "Reconciliation check"),
    "performance-regression": ("Baseline delta", "Profile target", "Regression check"),
}
MUTATING_DISCRIMINATOR = re.compile(
    r"^-\s*(?:set|change|modify|update|restart|deploy|delete|write|enable|disable)\b",
    re.IGNORECASE,
)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("output", type=Path)
    parser.add_argument("--expected", choices=(*ROUTES, "NO_MATCH"), required=True)
    args = parser.parse_args()

    text = args.output.read_text(encoding="utf-8")
    findings: list[str] = []
    lines = [line.strip() for line in text.splitlines() if line.strip()]
    first = lines[0] if lines else ""
    expected_first = f"ROUTE: {args.expected}"
    if first != expected_first:
        findings.append(f"first non-empty line must equal {expected_first}")

    route_lines = [line for line in lines if line.startswith("ROUTE:")]
    playbook_lines = [line for line in lines if line.startswith("PLAYBOOK:")]
    playbook_mentions = re.findall(r"PLAYBOOK:\s*([A-Za-z0-9_-]+)", text)
    headings = [line[3:].strip() for line in lines if line.startswith("## ")]
    all_route_sections = {section for sections in ROUTES.values() for section in sections}

    if len(route_lines) != 1:
        findings.append(f"expected one ROUTE marker, found {len(route_lines)}")
    if args.expected == "NO_MATCH":
        if playbook_mentions:
            findings.append("NO_MATCH must not emit PLAYBOOK")
        if headings != ["Missing discriminator"]:
            findings.append(f"NO_MATCH headings mismatch: {headings}")
        foreign = sorted(section for section in all_route_sections if section in text)
        if foreign:
            findings.append(f"NO_MATCH leaked playbook sections: {foreign}")
        missing_body = text.split("## Missing discriminator", 1)[1] if "## Missing discriminator" in text else ""
        bullets = [line for line in missing_body.splitlines() if line.strip().startswith("- ")]
        if len(bullets) != 1:
            findings.append(f"NO_MATCH must request exactly one discriminator bullet; found={len(bullets)}")
        elif MUTATING_DISCRIMINATOR.search(bullets[0].strip()):
            findings.append("NO_MATCH discriminator must not instruct a system mutation")
    else:
        expected_playbook = f"PLAYBOOK: {args.expected}"
        if playbook_lines != [expected_playbook]:
            findings.append(f"playbook marker mismatch: {playbook_lines}")
        if playbook_mentions != [args.expected]:
            findings.append(f"playbook mentions are not isolated: {playbook_mentions}")
        expected_sections = list(ROUTES[args.expected])
        if headings != expected_sections:
            findings.append(f"selected playbook headings mismatch: {headings}")
        foreign = sorted(
            section
            for section in all_route_sections - set(expected_sections)
            if section in text
        )
        if foreign:
            findings.append(f"foreign playbook sections: {foreign}")

    result = {"pass": not findings, "route": args.expected, "findings": findings}
    print(json.dumps(result, ensure_ascii=False, indent=2))
    if findings:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
