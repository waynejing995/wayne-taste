#!/usr/bin/env python3
"""Collect bounded observations for Wayne Plan AI evaluation."""

from __future__ import annotations

import argparse
import ast
import json
import re
import subprocess
from pathlib import Path


SECTIONS = (
    "Overview",
    "Problem Frame",
    "Requirements Trace",
    "Scope Boundaries",
    "Context",
    "Key Technical Decisions",
    "Open Questions",
    "File Structure",
    "Implementation Units",
    "Test Matrix",
    "Dead Code / Legacy Cleanup",
    "System-Wide Impact",
    "Risks & Dependencies",
    "Sources & References",
)
UNIT_FIELDS = (
    "Goal",
    "Requirements",
    "Dependencies",
    "Consumes",
    "Produces",
    "Files",
    "Approach",
    "Technical design",
    "Patterns",
    "Test scenarios",
    "E rows",
    "Verification",
    "Decision trace",
)
REQ_HEADER = "| Requirement | Owning units |"
REQ_SEPARATOR = "|---|---|"
U_HEADER = "| ID | Owner | Seed | Surface | Scenario | Status |"
U_SEPARATOR = "|---|---|---|---|---|---|"
DROP_HEADER = "| Seed | Reason |"
DROP_SEPARATOR = "|---|---|"
PLACEHOLDER_MARKER_RE = re.compile(r"\b(?:TBD|TODO)\b", re.IGNORECASE)
SURFACE_TOKEN_RE = re.compile(
    r"(?<![A-Za-z0-9_./:-])"
    r"([A-Za-z0-9_./-]+::[A-Za-z_][A-Za-z0-9_.]*)"
    r"(?![A-Za-z0-9_./:-])"
)
IGNORED_PARTS = {".git", ".pytest_cache", ".ruff_cache", ".venv", "__pycache__"}
def python_symbols(path: Path) -> set[str]:
    if path.suffix != ".py" or not path.is_file():
        return set()
    tree = ast.parse(path.read_text(encoding="utf-8"))
    symbols: set[str] = set()
    for node in tree.body:
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
            symbols.add(node.name)
        elif isinstance(node, (ast.Assign, ast.AnnAssign)):
            targets = node.targets if isinstance(node, ast.Assign) else [node.target]
            for target in targets:
                if isinstance(target, ast.Name):
                    symbols.add(target.id)
        if isinstance(node, ast.ClassDef):
            for child in node.body:
                if isinstance(child, (ast.FunctionDef, ast.AsyncFunctionDef)):
                    symbols.add(f"{node.name}.{child.name}")
                    for nested in ast.walk(child):
                        if (
                            isinstance(nested, (ast.Assign, ast.AnnAssign))
                            and isinstance(
                                nested.targets[0] if isinstance(nested, ast.Assign) else nested.target,
                                ast.Attribute,
                            )
                        ):
                            targets = nested.targets if isinstance(nested, ast.Assign) else [nested.target]
                            for target in targets:
                                if (
                                    isinstance(target, ast.Attribute)
                                    and isinstance(target.value, ast.Name)
                                    and target.value.id == "self"
                                ):
                                    symbols.add(f"{node.name}.{target.attr}")
    return symbols


def surface_exists(root: Path, surface: str) -> bool:
    path_text, symbol = surface.split("::", 1)
    path = root / path_text
    if not path.is_file():
        return False
    symbols = python_symbols(path)
    return symbol in symbols


def section(text: str, heading: str, level: int = 2) -> str:
    marks = "#" * level
    match = re.search(
        rf"^{re.escape(marks)} {re.escape(heading)}\s*$\n(.*?)(?=^{'#' * level} |\Z)",
        text,
        re.MULTILINE | re.DOTALL,
    )
    return match.group(1).strip() if match else ""


def table_after(text: str, header: str, separator: str) -> list[list[str]] | None:
    lines = text.splitlines()
    try:
        index = lines.index(header)
    except ValueError:
        return None
    if index + 1 >= len(lines) or lines[index + 1] != separator:
        return None
    rows: list[list[str]] = []
    for line in lines[index + 2 :]:
        if not line.startswith("|"):
            break
        if not line.endswith("|") or "\\|" in line:
            rows.append(["<malformed>"])
            continue
        rows.append([cell.strip() for cell in line[1:-1].split("|")])
    return rows


def source_ids(path: Path, pattern: str) -> set[str]:
    return set(re.findall(pattern, path.read_text(encoding="utf-8"), re.MULTILINE))


def source_e_table(matrix: Path) -> tuple[str, set[str]]:
    text = matrix.read_text(encoding="utf-8")
    match = re.search(
        r"^## E2E Verification Contract\s*$\n\n(\|[^\n]+\n\|[^\n]+\n(?:\|[^\n]+\n?)+)",
        text,
        re.MULTILINE,
    )
    if not match:
        return "", set()
    block = match.group(1).rstrip()
    return block, set(re.findall(r"^\|\s*(E\d+)\s*\|", block, re.MULTILINE))


def changed_paths(repo: Path, baseline: Path) -> tuple[list[str], list[str]]:
    del baseline
    if not (repo / ".git").is_dir():
        raise RuntimeError("trial repository must have a frozen Git baseline")

    def git(*args: str) -> list[str]:
        result = subprocess.run(
            ["git", "-C", str(repo), *args],
            check=True,
            capture_output=True,
            text=True,
        )
        return [line for line in result.stdout.splitlines() if line]

    modified = sorted(set(git("diff", "--name-only", "HEAD", "--")))
    added = sorted(set(git("ls-files", "--others", "--exclude-standard")))
    return modified, added


def validate_block(
    repo: Path, baseline: Path, output: Path, case: str
) -> list[str]:
    findings: list[str] = []
    modified, added = changed_paths(repo, baseline)
    if modified or added:
        findings.append(f"blocked case changed repository: modified={modified}, added={added}")

    lines = output.read_text(encoding="utf-8").splitlines()
    if len(lines) != 5 or any(not line.strip() for line in lines):
        findings.append(
            f"blocking response must contain exactly five non-empty lines and nothing else; found={len(lines)}"
        )
        return findings
    expected_reason = "PLAN_CONFLICT" if case == "conflict" else "MISSING_E2E"
    expected_owner = "product-design" if case == "conflict" else "test-design"
    expected_last = (
        "检测到批准决策与 active plan 冲突；请由 product-design 解决后重试。"
        if case == "conflict"
        else "E2E contract 缺失；请由 test-design 补充并批准后重试。"
    )
    expected_prefixes = (
        "STATUS: BLOCKED",
        f"REASON: {expected_reason}",
        "ARTIFACTS: ",
        f"OWNER: {expected_owner}",
        expected_last,
    )
    for index, expected in enumerate(expected_prefixes):
        actual = lines[index]
        if index == 2:
            if not actual.startswith(expected):
                findings.append("line 3 must start exactly with ARTIFACTS: ")
        elif actual != expected:
            findings.append(f"line {index + 1} mismatch: {actual!r}")

    artifacts = {
        item.strip()
        for item in lines[2].removeprefix("ARTIFACTS: ").split(";")
        if item.strip()
    }
    if not artifacts:
        findings.append("blocking response must name at least one artifact path")
    for artifact in artifacts:
        candidate = Path(artifact)
        if candidate.is_absolute() or ".." in candidate.parts or not (baseline / candidate).exists():
            findings.append(f"blocking artifact is not a normalized existing repo path: {artifact}")
    return findings


def unit_blocks(text: str) -> list[tuple[str, str, str]]:
    matches = list(re.finditer(r"^### Unit (I\d+) — (.+?)\s*$", text, re.MULTILINE))
    blocks: list[tuple[str, str, str]] = []
    for index, match in enumerate(matches):
        end = matches[index + 1].start() if index + 1 < len(matches) else len(text)
        blocks.append((match.group(1), match.group(2), text[match.end() : end]))
    return blocks


def validate_plan(repo: Path, baseline: Path) -> list[str]:
    findings: list[str] = []
    modified, added = changed_paths(repo, baseline)
    expected_added: list[str] = []
    for path in added:
        match = re.fullmatch(
            r"docs/plans/\d{4}-\d{2}-\d{2}-\d{3}-(?:feat|fix|refactor)-([a-z0-9-]+)-plan\.md",
            path,
        )
        if match and 3 <= len(match.group(1).split("-")) <= 5:
            expected_added.append(path)
    if modified:
        findings.append(f"upstream or repository files were modified: {modified}")
    if len(expected_added) != 1 or added != expected_added:
        findings.append(f"expected exactly one added canonical plan; added={added}")
        return findings

    plan_path = repo / expected_added[0]
    text = plan_path.read_text(encoding="utf-8")
    headings = re.findall(r"^## (.+?)\s*$", text, re.MULTILINE)
    if tuple(headings) != SECTIONS:
        findings.append(f"level-two section order mismatch: {headings}")
    if "gstack" in text.lower():
        findings.append("plan must not contain or invoke gstack")
    marker = PLACEHOLDER_MARKER_RE.search(text)
    if marker:
        findings.append(f"plan contains placeholder marker: {marker.group(0)}")

    spec = baseline / "docs/specs/2026-07-15-delivery-retry-design.md"
    decisions = baseline / "docs/decisions/2026-07-15-delivery-retry-decisions.md"
    matrix = baseline / "docs/test-matrix/2026-07-15-delivery-retry-matrix.md"
    requirements = source_ids(spec, r"^- (R\d+):",)
    decision_ids = source_ids(decisions, r"^\| (D\d+) \|",)
    seeds = source_ids(matrix, r"^\| (US\d+) \|",)
    e_block, e_ids = source_e_table(matrix)
    allowed_file_paths = {
        path.relative_to(baseline).as_posix()
        for path in baseline.rglob("*")
        if path.is_file() and not any(part in IGNORED_PARTS for part in path.parts)
    }
    allowed_file_paths.add("src/relay_queue/errors.py")
    test_body = section(text, "Test Matrix")
    source_e_lines = e_block.splitlines()
    test_lines = test_body.splitlines()
    table_starts = [index for index, line in enumerate(test_lines) if line.startswith("|")]
    plan_e_lines: list[str] = []
    if table_starts:
        first = table_starts[0]
        for line in test_lines[first:]:
            if not line.startswith("|"):
                break
            plan_e_lines.append(line)
    if (
        not e_block
        or plan_e_lines != source_e_lines
        or test_body.count(e_block) != 1
        or "<!--" in test_body
    ):
        findings.append("source E2E table is not the exact first Test Matrix table byte-for-byte")

    req_body = section(text, "Requirements Trace")
    req_rows = table_after(req_body, REQ_HEADER, REQ_SEPARATOR)
    req_map: dict[str, set[str]] = {}
    if req_rows is None:
        findings.append("Requirements Trace must use the exact two-column header and separator")
    else:
        for row in req_rows:
            if len(row) != 2 or not re.fullmatch(r"R\d+", row[0]):
                findings.append(f"malformed Requirements Trace row: {row}")
                continue
            if row[0] in req_map:
                findings.append(f"duplicate requirement row: {row[0]}")
            req_map[row[0]] = set(re.findall(r"I\d+", row[1]))
        if set(req_map) != requirements:
            findings.append(
                f"requirement coverage mismatch: missing={sorted(requirements - set(req_map))}, "
                f"extra={sorted(set(req_map) - requirements)}"
            )

    units = unit_blocks(section(text, "Implementation Units"))
    unit_ids = [unit_id for unit_id, _, _ in units]
    expected_unit_ids = [f"I{index}" for index in range(1, len(units) + 1)]
    if len(units) < 3 or unit_ids != expected_unit_ids:
        findings.append(f"unit IDs must be dependency-ordered I1..In with at least three units: {unit_ids}")
    unit_set = set(unit_ids)
    for req_id, owners in req_map.items():
        if not owners or not owners.issubset(unit_set):
            findings.append(f"requirement {req_id} has missing/unknown owners: {sorted(owners)}")

    unit_fields: dict[str, dict[str, str]] = {}
    produced: dict[str, set[str]] = {}
    unit_req_refs: dict[str, set[str]] = {}
    unit_u_refs: dict[str, set[str]] = {}
    unit_e_refs: dict[str, set[str]] = {}
    all_decision_refs: set[str] = set()
    for unit_id, _, block in units:
        fields = re.findall(r"^#### (.+?)\s*$", block, re.MULTILINE)
        if tuple(fields) != UNIT_FIELDS:
            findings.append(f"{unit_id} field order mismatch: {fields}")
            continue
        bodies = {field: section(block, field, 4) for field in UNIT_FIELDS}
        unit_fields[unit_id] = bodies
        for field, body in bodies.items():
            if not body:
                findings.append(f"{unit_id} field is empty: {field}")
        dependency_ids = set(re.findall(r"\bI\d+\b", bodies["Dependencies"]))
        current = int(unit_id[1:])
        known_earlier = {f"I{index}" for index in range(1, current)}
        if not dependency_ids.issubset(known_earlier):
            findings.append(f"{unit_id} has unknown, self, or later dependencies: {sorted(dependency_ids)}")
        if not dependency_ids and not re.search(r"\bnone\s+—\s+\S", bodies["Dependencies"], re.IGNORECASE):
            findings.append(f"{unit_id} Dependencies needs an earlier unit or exact 'none — <reason>'")
        produced[unit_id] = set(re.findall(r"(?:^|\s)([A-Za-z0-9_./-]+::[A-Za-z_][A-Za-z0-9_.]*)", bodies["Produces"]))
        unit_req_refs[unit_id] = set(re.findall(r"\bR\d+\b", bodies["Requirements"]))
        unknown_requirements = unit_req_refs[unit_id] - requirements
        if unknown_requirements:
            findings.append(f"{unit_id} references unknown requirements: {sorted(unknown_requirements)}")
        for existing_surface in re.findall(
            r"existing\s+([A-Za-z0-9_./-]+::[A-Za-z_][A-Za-z0-9_.]*)",
            bodies["Consumes"],
        ):
            if not surface_exists(baseline, existing_surface):
                findings.append(f"{unit_id} consumes missing existing surface: {existing_surface}")
        for source_unit, surface in re.findall(
            r"from (I\d+)\s+([A-Za-z0-9_./-]+::[A-Za-z_][A-Za-z0-9_.]*)",
            bodies["Consumes"],
        ):
            if source_unit not in dependency_ids:
                findings.append(f"{unit_id} consumes from {source_unit} without declaring dependency")
            if surface not in produced.get(source_unit, set()):
                findings.append(f"{unit_id} consumes undefined surface from {source_unit}: {surface}")
        for path in re.findall(r"(?:^|\s)(/?(?:[A-Za-z0-9_.-]+/)+[A-Za-z0-9_.-]+)::", bodies["Files"]):
            if path.startswith("/") or ".." in Path(path).parts:
                findings.append(f"{unit_id} has non-repo-relative file path: {path}")
        for line in bodies["Files"].splitlines():
            if not line.startswith("- "):
                continue
            canonical_match = re.fullmatch(
                r"- (Create|Modify|Delete) ([A-Za-z0-9_./-]+::[A-Za-z_][A-Za-z0-9_.]*) — \S.*",
                line.replace("`", ""),
            )
            legacy_match = re.fullmatch(
                r"- ([A-Za-z0-9_./-]+::[A-Za-z_][A-Za-z0-9_.]*) — (modify|new|delete): \S.*",
                line,
            )
            if canonical_match:
                operation, surface = canonical_match.groups()
                action = {"Create": "new", "Modify": "modify", "Delete": "delete"}[operation]
            elif legacy_match:
                surface, action = legacy_match.groups()
            else:
                findings.append(f"{unit_id} has malformed Files action: {line}")
                continue
            path_text = surface.split("::", 1)[0]
            path = Path(path_text)
            if path.is_absolute() or ".." in path.parts:
                findings.append(f"{unit_id} has non-repo-relative Files surface: {surface}")
            test_path_allowed = (
                bool(path.parts)
                and path.parts[0] == "tests"
                and path.suffix == ".py"
            )
            if path_text not in allowed_file_paths and not test_path_allowed:
                findings.append(f"{unit_id} Files surface is outside approved fixture scope: {surface}")
            if action in {"modify", "delete"} and not (baseline / path).is_file():
                findings.append(f"{unit_id} {action} path does not exist in baseline: {path_text}")
            if action == "delete" and not surface_exists(baseline, surface):
                findings.append(f"{unit_id} delete surface does not exist in baseline: {surface}")
        unit_u_refs[unit_id] = set(re.findall(r"\bU\d+\b", bodies["Test scenarios"]))
        unit_e_refs[unit_id] = set(re.findall(r"\bE\d+\b", bodies["E rows"]))
        all_decision_refs.update(re.findall(r"\bD\d+\b", bodies["Decision trace"]))

    if all_decision_refs != decision_ids:
        findings.append(
            f"decision trace mismatch: missing={sorted(decision_ids - all_decision_refs)}, "
            f"extra={sorted(all_decision_refs - decision_ids)}"
        )

    for requirement in requirements:
        owners_from_units = {
            unit_id for unit_id, refs in unit_req_refs.items() if requirement in refs
        }
        if req_map.get(requirement, set()) != owners_from_units:
            findings.append(
                f"requirement {requirement} bidirectional ownership mismatch: "
                f"trace={sorted(req_map.get(requirement, set()))}, units={sorted(owners_from_units)}"
            )

    test_body = section(text, "Test Matrix")
    u_rows = table_after(test_body, U_HEADER, U_SEPARATOR)
    u_by_owner: dict[str, set[str]] = {unit_id: set() for unit_id in unit_ids}
    mapped_seeds: list[str] = []
    seen_u_ids: set[str] = set()
    if u_rows is None:
        findings.append("Test Matrix must use the exact U-table header and separator")
    else:
        for row in u_rows:
            if len(row) != 6:
                findings.append(f"malformed U row: {row}")
                continue
            row_id, owner, seed, surface, scenario, status = row
            if not re.fullmatch(r"U\d+", row_id) or owner not in unit_set:
                findings.append(f"invalid U identity/owner: {row_id}/{owner}")
                continue
            if row_id in seen_u_ids:
                findings.append(f"duplicate U row ID: {row_id}")
            seen_u_ids.add(row_id)
            if status != "☐" or not re.fullmatch(r"US\d+|added", seed):
                findings.append(f"invalid U seed/status: {row_id}/{seed}/{status}")
            if not re.fullmatch(r"[A-Za-z0-9_./-]+::[A-Za-z_][A-Za-z0-9_.]*", surface):
                findings.append(f"invalid U surface: {row_id}/{surface}")
            if not scenario.strip():
                findings.append(f"U scenario is empty: {row_id}")
            u_by_owner.setdefault(owner, set()).add(row_id)
            if seed != "added":
                mapped_seeds.append(seed)
            bodies = unit_fields.get(owner, {})
            owned_surfaces = set(
                SURFACE_TOKEN_RE.findall(
                    bodies.get("Files", "") + "\n" + bodies.get("Produces", "")
                )
            )
            if surface not in owned_surfaces:
                findings.append(f"{row_id} surface is not owned by {owner} Files or Produces: {surface}")

    dropped_body = section(test_body, "Dropped Seeds", 3)
    dropped_rows = table_after(dropped_body, DROP_HEADER, DROP_SEPARATOR)
    dropped_seeds: list[str] = []
    if dropped_rows is None:
        findings.append("Dropped Seeds must use the exact header and separator")
    else:
        for row in dropped_rows:
            if len(row) != 2 or not re.fullmatch(r"US\d+", row[0]) or not row[1]:
                findings.append(f"malformed Dropped Seeds row: {row}")
                continue
            dropped_seeds.append(row[0])

    dispositions = mapped_seeds + dropped_seeds
    missing_seeds = sorted(seed for seed in seeds if dispositions.count(seed) == 0)
    duplicate_seeds = sorted(seed for seed in seeds if dispositions.count(seed) != 1)
    extra_seeds = sorted(set(dispositions) - seeds)
    if missing_seeds or duplicate_seeds or extra_seeds:
        findings.append(
            f"U-SEED disposition mismatch: missing={missing_seeds}, "
            f"not-exactly-once={duplicate_seeds}, extra={extra_seeds}"
        )

    for unit_id in unit_ids:
        if not u_by_owner.get(unit_id):
            findings.append(f"feature-bearing unit has no owned U row: {unit_id}")
        if u_by_owner.get(unit_id, set()) != unit_u_refs.get(unit_id, set()):
            findings.append(
                f"{unit_id} U ownership mismatch: table={sorted(u_by_owner.get(unit_id, set()))}, "
                f"field={sorted(unit_u_refs.get(unit_id, set()))}"
            )
    referenced_e = set().union(*unit_e_refs.values()) if unit_e_refs else set()
    if referenced_e != e_ids:
        findings.append(
            f"E-row coverage mismatch: missing={sorted(e_ids - referenced_e)}, "
            f"extra={sorted(referenced_e - e_ids)}"
        )
    return findings


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("repo", type=Path)
    parser.add_argument("baseline", type=Path)
    parser.add_argument("--case", choices=("normal", "conflict", "missing-e2e"), required=True)
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()

    if args.case == "normal":
        findings = validate_plan(args.repo, args.baseline)
    else:
        if args.output is None:
            raise SystemExit("--output is required for blocked cases")
        findings = validate_block(args.repo, args.baseline, args.output, args.case)
    result = {
        "semantic_verdict": "AI_REVIEW_REQUIRED",
        "case": args.case,
        "observations": findings,
    }
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
