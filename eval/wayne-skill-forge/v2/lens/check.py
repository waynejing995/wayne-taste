from __future__ import annotations

import argparse
import json
import re
from pathlib import Path


SECTIONS = (
    "Application use",
    "Change summary",
    "Impact scenarios",
    "Risk classification",
    "Precautions",
)
ALLOWED_VERDICTS = {"ACCEPTABLE", "ACCEPTABLE-WITH-PRECAUTIONS", "UNACCEPTABLE", "DECLINE"}


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("case", type=str)
    parser.add_argument("trial_workspace", type=Path)
    args = parser.parse_args()

    answer_file = args.trial_workspace / "answer.md"
    case_file = Path(__file__).parent / "cases" / f"{args.case}.md"
    
    if not answer_file.exists():
        result = {
            "pass": False,
            "verdict": None,
            "findings": ["answer.md not found in trial workspace"],
        }
        print(json.dumps(result, ensure_ascii=False, indent=2))
        raise SystemExit(1)

    text = answer_file.read_text(encoding="utf-8")
    case_text = case_file.read_text(encoding="utf-8") if case_file.exists() else ""
    
    findings: list[str] = []
    lines = [line for line in text.splitlines() if line.strip()]
    first = lines[0].strip() if lines else ""
    match = re.fullmatch(r"VERDICT: ([A-Z\-]+)", first)
    verdict = match.group(1) if match else ""
    
    if not match or verdict not in ALLOWED_VERDICTS:
        findings.append("first non-empty line must be one allowed VERDICT")

    # Expected verdicts per case (based on risk class definitions from intent)
    expected_verdicts = {
        "straightforward-safe-upgrade": {"ACCEPTABLE"},
        "breaking-change-workaround-exists": {"ACCEPTABLE-WITH-PRECAUTIONS"},
        "breaking-change-critical-path": {"UNACCEPTABLE"},
        "unlock-security-fix": {"ACCEPTABLE-WITH-PRECAUTIONS"},
        "mixed-breaking-and-capability": {"ACCEPTABLE-WITH-PRECAUTIONS"},
        "partial-decline-mixed-scope": {"ACCEPTABLE"},  # Must provide in-scope verdict + decline sentence
        "decline-no-context": {"DECLINE"},
        "decline-holistic-monorepo": {"DECLINE"},
    }
    
    if args.case in expected_verdicts:
        if verdict not in expected_verdicts[args.case]:
            findings.append(
                f"verdict {verdict or '<missing>'} is invalid for {args.case}; "
                f"expected one of {expected_verdicts[args.case]}"
            )

    headings = re.findall(r"^## (.+?)\s*$", text, re.MULTILINE)

    # DECLINE verdicts: no review sections, must have reason line
    if verdict == "DECLINE":
        if any(h in SECTIONS for h in headings):
            findings.append("DECLINE must not simulate the upgrade review sections")
        if len(lines) < 2:
            findings.append("DECLINE must include a concise reason line")
    else:
        # Non-decline upgrade verdicts: check section structure
        # For mixed requests, allow an upgrade verdict + one sentence declining out-of-scope
        if verdict != "DECLINE":
            # Required sections for upgrade verdicts (before any out-of-scope decline)
            required_core = ("Application use", "Change summary", "Impact scenarios", "Risk classification")
            
            # Extract section positions (before any out-of-scope text)
            found_core = tuple(h for h in headings if h in required_core)
            if found_core != required_core:
                missing = [h for h in required_core if h not in found_core]
                findings.append(f"missing required sections: {missing}")
            
            # Check section bodies
            section_bodies: dict[str, str] = {}
            for name in required_core:
                section_match = re.search(
                    rf"^## {re.escape(name)}\s*$\n(.*?)(?=^## |\Z)",
                    text,
                    re.MULTILINE | re.DOTALL,
                )
                section_bodies[name] = section_match.group(1).strip() if section_match else ""
                if not section_bodies[name]:
                    findings.append(f"empty section: {name}")
            
            # Precautions section: required unless verdict is ACCEPTABLE and no precautions mentioned
            precautions_match = re.search(
                r"^## Precautions\s*$\n(.*?)(?=^## |\Z)",
                text,
                re.MULTILINE | re.DOTALL,
            )
            precautions_text = precautions_match.group(1).strip() if precautions_match else ""
            
            if verdict != "ACCEPTABLE":
                if not precautions_match:
                    findings.append(f"Precautions section required for verdict {verdict}")
                elif not precautions_text:
                    findings.append("Precautions section must be non-empty")
            else:
                # For ACCEPTABLE verdict, Precautions can be omitted, but if present must be non-empty
                if precautions_match and not precautions_text:
                    findings.append("Precautions section must be non-empty")
            
            # Check section order: all required sections before Precautions
            section_positions = {}
            for section in SECTIONS:
                match = re.search(rf"^## {re.escape(section)}\s*$", text, re.MULTILINE)
                if match:
                    section_positions[section] = match.start()
            
            if len(section_positions) >= 2:
                sorted_sections = sorted(section_positions.keys(), key=lambda s: section_positions[s])
                expected_order = [s for s in SECTIONS if s in sorted_sections]
                if sorted_sections != expected_order:
                    findings.append(f"section order mismatch: {sorted_sections} vs expected {expected_order}")

    # Extract evidence references from input
    input_sections = set(re.findall(r"§(\d+(?:\.\d+)?)", case_text))
    
    # Valid line numbers: (1) any line in the case file, AND (2) any line mentioned in input via "line(s) N(-M)"
    case_line_count = len(case_text.splitlines())
    valid_line_numbers = set(str(i) for i in range(1, case_line_count + 1))
    # Also accept line numbers explicitly mentioned in the input
    for match in re.finditer(r"\blines? (\d+)(?:[-–](\d+))?", case_text):
        start = int(match.group(1))
        end = int(match.group(2)) if match.group(2) else start
        for line_num in range(start, end + 1):
            valid_line_numbers.add(str(line_num))
    
    input_e_ids = set(re.findall(r"\[E(\d+)\]", case_text))
    
    # Check answer references exist in input
    # Section references (§N.M)
    answer_sections = re.findall(r"§(\d+(?:\.\d+)?)", text)
    for section_ref in answer_sections:
        if section_ref not in input_sections:
            findings.append(f"invented or inexact section reference: §{section_ref}")
    
    # Line references (line N or line N-M or lines N-M)
    for match in re.finditer(r"\blines? (\d+)(?:[-–](\d+))?", text, re.IGNORECASE):
        start = int(match.group(1))
        end = int(match.group(2)) if match.group(2) else start
        for line_num in range(start, end + 1):
            if str(line_num) not in valid_line_numbers:
                findings.append(f"line reference out of range: line {line_num}")
                break  # Only report once per range
    
    # Evidence ID references ([EN])
    answer_e_ids = re.findall(r"\[E(\d+)\]", text)
    for e_id in answer_e_ids:
        if e_id not in input_e_ids:
            findings.append(f"invented evidence ID: [E{e_id}]")

    result = {"pass": not findings, "verdict": verdict or None, "findings": findings}
    print(json.dumps(result, ensure_ascii=False, indent=2))
    if findings:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
