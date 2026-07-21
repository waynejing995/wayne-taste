#!/usr/bin/env python3
"""Collect matrix observations for Wayne Test Design semantic review."""

from __future__ import annotations

import argparse
import json
import re
import subprocess
from pathlib import Path


CASES = {"provider-isolation", "proof-axis", "missing-native-evidence", "simple", "absorb-existing"}
HEADER = "| ID | User path | Env: process | Env: data | Env: entrypoint | Observable (pass = ?) | Status |"
LEGACY_HEADER = "| # | User path | Env: process | Env: data | Env: entrypoint | Observable (pass = ?) | Status |"


def git(repo: Path, *args: str) -> str:
    return subprocess.run(["git", *args], cwd=repo, check=True, capture_output=True, text=True).stdout


def e_rows(text: str) -> list[str]:
    start = text.find(HEADER)
    if start < 0:
        return []
    rows: list[str] = []
    for line in text[start:].splitlines()[2:]:
        if not line.startswith("|"):
            if rows:
                break
            continue
        if re.match(r"^\|\s*(?:#|-)", line):
            continue
        rows.append(line)
    return rows


def u_rows(text: str) -> list[str]:
    rows = []
    for line in text.splitlines():
        if re.match(r"^\|\s*U[-0-9]", line, re.IGNORECASE):
            rows.append(line)
    return rows


def has_row(rows: list[str], *terms: str) -> bool:
    return any(all(term.lower() in row.lower() for term in terms) for row in rows)


def is_fanout_row(row: str) -> bool:
    lower = row.lower()
    return (
        "fan-out" in lower
        or "fanout" in lower
        or re.search(r"\bfans?\b.{0,40}\bout\b", lower) is not None
    )


def row_cells(row: str) -> list[str]:
    return [cell.strip() for cell in row.strip().strip("|").split("|")]


def is_justified_fanout(row: str) -> bool:
    lower = row.lower()
    cells = row_cells(row)
    if len(cells) != 7:
        return False
    observable = cells[5].lower()
    return (
        "alpha" in lower
        and "beta" in lower
        and is_fanout_row(row)
        and ("both" in observable or ("alpha" in observable and "beta" in observable))
        and re.search(r"fail|down", lower) is not None
        and re.search(r"result|outcome|entr", observable) is not None
    )


def proof_axes(row: str) -> set[str]:
    """Classify the row's asserted proof, not incidental setup vocabulary."""
    lower = row.lower()
    axes: set[str] = set()
    if (
        "policy unverified" in lower
        or re.search(r"tokens? (?:stream|appear progressively)", lower)
        or re.search(r"(?:output|answer|reply) (?:streams?|appears? progressively)", lower)
        or "token-by-token" in lower
    ):
        axes.add("stream")
    if (
        re.search(r"\bresume|\breconnect|\bdisconnect", lower)
        and re.search(r"remaining|exactly once|no (?:duplicate|replay|gap|missing)|same session", lower)
    ):
        axes.add("resume")
    if "policy_state" in lower:
        axes.add("policy_state")
    semantic_cleanup = (
        re.search(r"terminal.{0,30}fail|fail.{0,30}terminal", lower) is not None
        and "child" in lower
        and "lease" in lower
        and re.search(r"gone|releas|no longer|re-?acquir|can be acquired", lower) is not None
    )
    if semantic_cleanup:
        axes.add("cleanup")
    return axes


def names_missing_native_proof(text: str) -> bool:
    return re.search(
        r"(?:no|missing|unavailable|absence of).{0,60}native (?:runtime )?"
        r"(?:field|event|record|evidence|proof)|"
        r"native (?:runtime )?(?:field|event|record|evidence|proof).{0,60}"
        r"(?:missing|unavailable|does not exist|none)",
        text,
    ) is not None


def check(workspace: Path, case_name: str) -> list[str]:
    findings: list[str] = []
    repo = workspace / "repo"
    matrix = repo / "docs/test-matrix/matrix.md"
    if not matrix.is_file():
        return ["matrix artifact missing"]
    changed = [row[3:] for row in git(repo, "status", "--porcelain=v1", "--untracked-files=all").splitlines() if len(row) > 3]
    if changed != ["docs/test-matrix/matrix.md"]:
        findings.append(f"wrote outside the approved matrix path: {changed}")
    text = matrix.read_text(encoding="utf-8")
    lower = text.lower()
    useed_label = "U-SEED (wayne-plan re-authors + locks)"
    explicit_no_useed = re.search(r"U-SEED:\s*none\s*[—-]\s*\S", text) is not None
    if useed_label not in text or (not u_rows(text) and not explicit_no_useed):
        findings.append("matrix omits provisional U-SEED ownership/status")
    if HEADER not in text and LEGACY_HEADER not in text:
        findings.append("matrix omits the locked E2E header")
    rows = e_rows(text)
    u = u_rows(text)
    if any(not row.rstrip().endswith("☐ |") for row in u):
        findings.append("U-SEED contains executor-owned completed status")
    if rows and any(not row.rstrip().endswith("⬜ |") for row in rows):
        findings.append("E2E design contains executor-owned completed status")

    if case_name == "provider-isolation":
        if "proof-axis audit" not in lower:
            findings.append("provider matrix omits E2E Proof-Axis Audit")
        for provider, native in (("alpha", "runtime.policy_verified"), ("beta", "response.attestation_state")):
            if not has_row(rows, provider, "stream"):
                findings.append(f"missing provider-specific functional row: {provider}")
            if not has_row(rows, provider, native):
                findings.append(f"missing provider-specific native attestation row: {provider}")
        if "policy unverified" not in lower:
            findings.append("weaker functional mode omits POLICY UNVERIFIED")
        if not any(is_justified_fanout(row) for row in rows):
            findings.append("missing justified cross-provider fan-out row")
        for row in rows:
            row_lower = row.lower()
            if "stream" in row_lower and ("policy_verified" in row or "attestation_state" in row) and not re.search(r"not claim|does not|cannot|isn't|is not", row_lower):
                findings.append("functional and attestation proof axes are coupled")
    elif case_name == "proof-axis":
        axes = ("stream", "resume", "policy_state", "cleanup")
        for axis in axes:
            if not any(axis in proof_axes(row) for row in rows):
                findings.append(f"missing independent proof axis: {axis}")
        for row in rows:
            if len(proof_axes(row)) > 1:
                findings.append("multiple proof axes share one E2E row")
        if "policy unverified" not in lower:
            findings.append("reachable functional path is not labeled POLICY UNVERIFIED")
    elif case_name == "missing-native-evidence":
        if not re.search(r"capability conflict|scope conflict|proof conflict|missing native", lower):
            findings.append("missing-native capability conflict is not surfaced")
        if not re.search(r"(?:plan|planning).{0,50}(?:stop|block)|(?:stop|block).{0,50}(?:plan|planning)", lower):
            findings.append("unresolved capability conflict does not block planning")
        if "--encrypted-reasoning" not in text or not re.search(r"intent|request", lower):
            findings.append("flag/help evidence is not classified as requested intent")
        if not names_missing_native_proof(lower):
            findings.append("missing native runtime proof is not named")
        for row in rows:
            row_lower = row.lower()
            if "gamma" in row_lower and "encrypted" in row_lower and not re.search(
                r"reject|unavailable|missing|fail|stop|conflict|blocked|no native|absence",
                row_lower,
            ):
                findings.append("matrix authors unreachable positive Gamma capability row")
    elif case_name == "simple":
        lower_case = (
            has_row(u, "lower")
            or has_row(u, '"Hello World"', '"hello-world"')
            or has_row(u, '"Ab C"', '"ab-c"')
        )
        empty_case = has_row(u, "empty") or any(row.count('""') >= 2 for row in u)
        for term, present in (("lower", lower_case), ("empty", empty_case), ("typeerror", has_row(u, "typeerror"))):
            if not present:
                findings.append(f"simple U-SEED misses behavior: {term}")
        if rows:
            findings.append("pure function received invented E2E rows")
        if "e2e: none" not in lower:
            findings.append("pure function omits explicit E2E none declaration")
        if any(re.search(r"concurrency|persistence|auth|network", row, re.IGNORECASE) for row in u):
            findings.append("simple matrix over-designs impossible dimensions")
    elif case_name == "absorb-existing":
        exact = '| E-EXACT | User exports the report | `tool service --port 9000` | fixture `reports/demo.db` | `tool export --format json` | downloaded `report.json` contains exact JSON `{"ok":true}` | ⬜ |'
        if text.count(exact) != 1:
            findings.append("existing E2E row is not carried verbatim exactly once")
        if not re.search(r"absorb|supersed|single source|ssot", lower):
            findings.append("matrix does not declare absorbed E2E ownership")
        if git(repo, "diff", "--", "docs/spec.md"):
            findings.append("source spec was modified instead of absorbed")
    return findings


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("workspace", type=Path)
    parser.add_argument("--case", required=True, choices=sorted(CASES))
    args = parser.parse_args()
    findings = check(args.workspace.resolve(), args.case)
    result = {
        "semantic_verdict": "AI_REVIEW_REQUIRED",
        "case": args.case,
        "observations": findings,
    }
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
