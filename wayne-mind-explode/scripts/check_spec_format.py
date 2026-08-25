"""Mechanical checks for a spec written against the current spec contract.

Covers only what a machine can decide: the bounded sections downstream stages
parse, the R/D contracts, the narrative/appendix split, architectural layering,
and the prose habits with a measurable signature. Everything else in the
contract is a human review item and is deliberately absent here.

Usage:
    uv run python check_spec_format.py <spec.md> [--compare <original.md>]
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

import click
from loguru import logger

# Parsed literally by eval/wayne-mind-explode/check_trial.py and decision_log.py.
BOUNDED = (
    "## Requirements",
    "## Architecture",
    "## Technology and frameworks",
    "## Interfaces",
    "## Verification",
    "## Decisions",
)

NARRATIVE = (
    "## Abstract",
    "## Background",
    "## Problem statement",
    "## Goals",
    "## Non-goals",
    "## Architecture",
    "## Interfaces",
    "## Flows",
    "## Failure and concurrency",
)

DIVIDER = "# Appendices"


def section(text: str, name: str) -> str:
    match = re.search(rf"^## {re.escape(name)}\b(.*?)(?=^## |\Z)", text, re.M | re.S)
    return match.group(1) if match else ""


def strip_code(text: str) -> str:
    return re.sub(r"(?ms)^```.*?^```", "", text)


def check_bounded(text: str) -> list[str]:
    return [f"omits {h}" for h in BOUNDED if h not in text]


def check_requirements(text: str) -> list[str]:
    findings: list[str] = []
    req, ver = section(text, "Requirements"), section(text, "Verification")
    ids = re.findall(r"^###\s+(R[1-9]\d*)\s", req, re.M)
    if not ids:
        return ["no numbered R<n> requirements"]
    if len(ids) != len(set(ids)):
        findings.append(f"duplicate requirement id in {ids}")
    for block in re.split(r"(?m)^(?=###\s+R[1-9]\d*\s)", req)[1:]:
        name = re.match(r"###\s+(R[1-9]\d*)\s", block).group(1)
        for field in ("Current", "Target", "Acceptance"):
            seen = len(re.findall(rf"^-\s+\*\*{field}\*\*\s+—\s+\S", block, re.M))
            if seen != 1:
                findings.append(f"{name} carries {seen} {field} lines")
    for rid in ids:
        proofs = len(re.findall(rf"^\|\s*{rid}\s*\|", ver, re.M))
        if proofs != 1:
            findings.append(f"{rid} has {proofs} verification proofs")
    return findings


def check_decisions(text: str) -> list[str]:
    body = strip_code(section(text, "Decisions"))
    ids = re.findall(r"^###\s+(D[1-9]\d*)", body, re.M)
    if not ids:
        return ["no numbered D<n> decisions"]
    dupes = {i for i in ids if ids.count(i) > 1}
    return [f"decision id appears twice: {sorted(dupes)}"] if dupes else []


def check_split(text: str) -> tuple[list[str], int, int]:
    """The narrative must precede the divider and the numbered source follow it."""
    if DIVIDER not in text:
        return ([f"no `{DIVIDER}` divider"], len(text.splitlines()), 0)
    head, tail = text.split(DIVIDER, 1)
    findings = [f"{h} sits below the divider" for h in NARRATIVE if h in tail]
    findings += [
        f"{h} sits above the divider"
        for h in ("## Requirements", "## Verification", "## Decisions")
        if h in head
    ]
    return findings, len(head.splitlines()), len(tail.splitlines())


def check_layering(text: str) -> tuple[list[str], list[str]]:
    arch = section(text, "Architecture")
    levels = re.findall(r"^###\s+(.+)$", arch, re.M)
    findings: list[str] = []
    if len(levels) < 2:
        findings.append(f"architecture has {len(levels)} levels; it was not layered")
    # Deliberately no diagram-count gate. Requiring one diagram per level fires on
    # leaf levels that are a single boundary, and the only way to satisfy it there
    # is a diagram restating the prose — which the contract separately forbids. An
    # acceptance run hit exactly that. Prose per level is the checkable obligation;
    # whether a level needs a diagram is a judgement the reviewer makes.
    for level, block in zip(levels, re.split(r"(?m)^###\s+.+$", arch)[1:]):
        if not strip_code(re.sub(r"^\|.*$", "", block, flags=re.M)).strip():
            findings.append(f"level '{level}' has no prose")
    return findings, levels


def check_prose(text: str) -> list[str]:
    """Only habits with a measurable signature. Judgement calls stay with review."""
    narrative = text.split(DIVIDER, 1)[0]
    findings: list[str] = []

    pointers = re.findall(
        r"^(?![|>#\-]).*\b(?:behaves as|as defined (?:by|in)|see) (?:R|D)[1-9]\d*\b.*$",
        narrative,
        re.M,
    )
    for line in pointers[:5]:
        findings.append(f"pointer instead of description: {line.strip()[:80]}")

    body = strip_code(section(text, "Decisions"))
    slogans = [
        h
        for h in re.findall(r"^###\s+D[1-9]\d*[^\n]*$", body, re.M)
        if re.search(r", not |, never | is not (?:a|an|the) ", h)
    ]
    for h in slogans[:5]:
        findings.append(f"antithesis heading: {h.strip()[:80]}")

    return findings


def report(label: str, findings: list[str]) -> bool:
    if findings:
        logger.error(f"{label}: {len(findings)} finding(s)")
        for f in findings:
            logger.error(f"    {f}")
        return False
    logger.info(f"{label}: pass")
    return True


@click.command()
@click.argument("spec", type=click.Path(exists=True, path_type=Path))
@click.option("--compare", type=click.Path(exists=True, path_type=Path),
              help="Original spec; checks that no R/D id was dropped.")
@click.option("-v", "verbose", is_flag=True, help="Show DEBUG output.")
def main(spec: Path, compare: Path | None, verbose: bool) -> None:
    logger.remove()
    logger.add(sys.stderr, level="DEBUG" if verbose else "INFO", format="{message}")

    text = spec.read_text(encoding="utf-8")
    logger.info(f"checking {spec} ({len(text.splitlines())} lines)")

    split_findings, head_lines, tail_lines = check_split(text)
    layer_findings, levels = check_layering(text)

    ok = all([
        report("bounded sections", check_bounded(text)),
        report("requirements", check_requirements(text)),
        report("decisions", check_decisions(text)),
        report("narrative/appendix split", split_findings),
        report("architecture layering", layer_findings),
        report("prose", check_prose(text)),
    ])

    logger.info(f"narrative {head_lines} lines / appendix {tail_lines} lines")
    logger.info(f"architecture levels: {levels or 'none'}")

    if compare:
        old = compare.read_text(encoding="utf-8")
        lost: list[str] = []
        for kind in ("R", "D"):
            was = set(re.findall(rf"^###\s+({kind}[1-9]\d*)", old, re.M))
            now = set(re.findall(rf"^###\s+({kind}[1-9]\d*)", text, re.M))
            # A merged heading such as `D25 + D109` still declares both ids.
            now |= set(re.findall(rf"\b({kind}[1-9]\d*)\b", "\n".join(
                re.findall(rf"^###\s+{kind}[^\n]*$", text, re.M))))
            lost += [f"{i} present in {compare.name}, absent here" for i in sorted(was - now)]
        ok &= report("id preservation", lost)

    sys.exit(0 if ok else 1)


if __name__ == "__main__":
    main()
