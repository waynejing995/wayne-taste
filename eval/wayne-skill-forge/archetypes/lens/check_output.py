from __future__ import annotations

import argparse
import json
import re
from pathlib import Path


SECTIONS = (
    "Observations",
    "Inferences",
    "Alternatives",
    "Missing discriminator",
    "Next evidence",
)
ALLOWED = {"SUPPORTED", "PLAUSIBLE", "INSUFFICIENT", "CONTRADICTED", "DECLINE"}


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("output", type=Path)
    parser.add_argument("evidence", type=Path)
    parser.add_argument("--case", choices=("supported", "ambiguous", "decline"), required=True)
    args = parser.parse_args()

    text = args.output.read_text(encoding="utf-8")
    source = args.evidence.read_text(encoding="utf-8")
    findings: list[str] = []
    lines = [line for line in text.splitlines() if line.strip()]
    first = lines[0].strip() if lines else ""
    match = re.fullmatch(r"VERDICT: ([A-Z]+)", first)
    verdict = match.group(1) if match else ""
    if not match or verdict not in ALLOWED:
        findings.append("first non-empty line must be one allowed VERDICT")

    expected = {
        "supported": {"SUPPORTED"},
        "ambiguous": {"PLAUSIBLE", "INSUFFICIENT"},
        "decline": {"DECLINE"},
    }[args.case]
    if verdict not in expected:
        findings.append(f"verdict {verdict or '<missing>'} is invalid for {args.case}")

    headings = re.findall(r"^## (.+?)\s*$", text, re.MULTILINE)
    if args.case == "decline":
        if headings:
            findings.append("DECLINE must not simulate the causal review sections")
        if len(lines) < 2:
            findings.append("DECLINE must include a concise reason line")
        if len(text) > 600:
            findings.append("DECLINE response is not concise")
    else:
        if tuple(headings) != SECTIONS:
            findings.append(f"causal section order mismatch: {headings}")
        section_bodies: dict[str, str] = {}
        for name in SECTIONS:
            section_match = re.search(
                rf"^## {re.escape(name)}\s*$\n(.*?)(?=^## |\Z)",
                text,
                re.MULTILINE | re.DOTALL,
            )
            section_bodies[name] = section_match.group(1).strip() if section_match else ""
            if not section_bodies[name]:
                findings.append(f"empty causal section: {name}")
        source_ids = set(re.findall(r"\[(E\d+)\]", source))
        cited_ids = set(re.findall(r"\[(E\d+)\]", text))
        unknown = sorted(cited_ids - source_ids)
        if unknown:
            findings.append(f"invented evidence IDs: {unknown}")
        observation_bullets = [
            line.strip()
            for line in section_bodies.get("Observations", "").splitlines()
            if line.strip().startswith("- ")
        ]
        if not observation_bullets:
            findings.append("Observations must contain at least one evidence bullet")
        for bullet in observation_bullets:
            if not re.match(r"^- \[E\d+\]\s+\S", bullet):
                findings.append(f"Observation bullet must start with one evidence ID: {bullet}")

    result = {"pass": not findings, "verdict": verdict or None, "findings": findings}
    print(json.dumps(result, ensure_ascii=False, indent=2))
    if findings:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
