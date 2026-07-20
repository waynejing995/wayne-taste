#!/usr/bin/env python3
"""Validate Wayne plans against their original sources and repository snapshot."""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import sys
from datetime import date
from pathlib import Path
from typing import Any


H2_ORDER = [
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
]
UNIT_FIELDS = [
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
]
FRONTMATTER_KEYS = ["title", "type", "status", "date", "origin", "decisions"]
BANNED = [
    "TBD",
    "TODO",
    "implement later",
    "add error handling",
    "add validation",
    "handle edge cases",
    "write tests",
    "similar to Unit",
]
PLAN_PATH_RE = re.compile(
    r"^docs/plans/(\d{4}-\d{2}-\d{2})-(\d{3})-(feat|fix|refactor)-"
    r"([a-z0-9]+(?:-[a-z0-9]+){2,4})-plan\.md$"
)
SURFACE_RE = re.compile(
    r"(?P<path>(?:[A-Za-z0-9_.-]+/)*[A-Za-z0-9_.-]+)::"
    r"(?P<symbol>[A-Za-z_][A-Za-z0-9_.:-]*)"
)
SENTINEL_RE = re.compile(r"^none — \S(?:.*\S)?$")
HAN_RE = re.compile(r"[\u3400-\u4dbf\u4e00-\u9fff]")


class Findings:
    def __init__(self) -> None:
        self.items: list[tuple[str, str]] = []

    def add(self, code: str, message: str) -> None:
        self.items.append((code, message))

    def emit(self) -> int:
        if not self.items:
            print("PASS")
            return 0
        for code, message in self.items:
            print(f"ERROR [{code}] {message}")
        return 1


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def ignored(relative: Path) -> bool:
    return ".git" in relative.parts


def inventory(repo_root: Path, excluded: set[str] | None = None) -> dict[str, str]:
    excluded = excluded or set()
    files: dict[str, str] = {}
    for path in sorted(repo_root.rglob("*")):
        if not path.is_file():
            continue
        relative_path = path.relative_to(repo_root)
        relative = relative_path.as_posix()
        if ignored(relative_path) or relative in excluded:
            continue
        files[relative] = sha256(path)
    return files


def is_within(path: Path, root: Path) -> bool:
    try:
        path.relative_to(root)
        return True
    except ValueError:
        return False


def valid_relative(value: str) -> bool:
    path = Path(value)
    return bool(value) and not path.is_absolute() and "\\" not in value and ".." not in path.parts


def read_json(path: Path, findings: Findings, code: str) -> Any:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeError, json.JSONDecodeError) as exc:
        findings.add(code, f"cannot read {path}: {exc}")
        return None


def parse_frontmatter(text: str, findings: Findings) -> tuple[dict[str, str], str]:
    match = re.match(r"\A---\n(.*?)\n---\n(.*)\Z", text, re.DOTALL)
    if not match:
        findings.add("frontmatter", "expected LF-delimited YAML frontmatter")
        return {}, text
    values: dict[str, str] = {}
    keys: list[str] = []
    for line in match.group(1).splitlines():
        if ":" not in line:
            findings.add("frontmatter", f"invalid frontmatter line: {line!r}")
            continue
        key, value = line.split(":", 1)
        key = key.strip()
        value = value.strip()
        keys.append(key)
        if not value:
            findings.add("frontmatter", f"frontmatter {key!r} is empty")
        values[key] = value
    if keys != FRONTMATTER_KEYS:
        findings.add("frontmatter-keys", f"expected {FRONTMATTER_KEYS}; found {keys}")
    return values, match.group(2)


def h2_sections(body: str, findings: Findings) -> dict[str, str]:
    matches = list(re.finditer(r"^## (?!#)(.+?)\s*$", body, re.MULTILINE))
    names = [match.group(1) for match in matches]
    if names != H2_ORDER:
        findings.add("h2-order", f"expected {H2_ORDER}; found {names}")
    sections: dict[str, str] = {}
    for index, match in enumerate(matches):
        end = matches[index + 1].start() if index + 1 < len(matches) else len(body)
        sections[match.group(1)] = body[match.end() : end].strip("\n")
    return sections


def parse_row(line: str) -> list[str] | None:
    stripped = line.strip()
    if not (stripped.startswith("|") and stripped.endswith("|")):
        return None
    return [cell.strip() for cell in stripped[1:-1].split("|")]


def markdown_tables(text: str) -> list[tuple[str, list[str]]]:
    lines = text.splitlines()
    tables: list[tuple[str, list[str]]] = []
    index = 0
    while index < len(lines):
        if parse_row(lines[index]) is None:
            index += 1
            continue
        start = index
        block: list[str] = []
        while index < len(lines) and parse_row(lines[index]) is not None:
            block.append(lines[index])
            index += 1
        if len(block) >= 2:
            tables.append(("\n".join(block), block))
        if index == start:
            index += 1
    return tables


def markdown_separator(row: list[str]) -> bool:
    return bool(row) and all(re.fullmatch(r":?-{3,}:?", cell) for cell in row)


def extract_u_seed_rows(matrix_text: str, findings: Findings) -> dict[str, str]:
    headings = list(re.finditer(r"^## (?!#)(.+?)\s*$", matrix_text, re.MULTILINE))
    matches = [
        (index, match)
        for index, match in enumerate(headings)
        if match.group(1) == "U-SEED"
    ]
    if len(matches) != 1:
        findings.add("source-u-seed-section", "matrix must contain exactly one ## U-SEED section")
        return {}
    heading_index, heading = matches[0]
    end = headings[heading_index + 1].start() if heading_index + 1 < len(headings) else len(matrix_text)
    section = matrix_text[heading.end() : end]
    tables: list[list[str]] = []
    for _, lines in markdown_tables(section):
        header = parse_row(lines[0]) or []
        separator = parse_row(lines[1]) or []
        if len(header) == len(separator) and markdown_separator(separator):
            tables.append(lines)
    if len(tables) != 1:
        findings.add(
            "source-u-seed-table",
            "## U-SEED must contain exactly one Markdown table with a header and separator",
        )
        return {}

    lines = tables[0]
    column_count = len(parse_row(lines[0]) or [])
    rows: dict[str, str] = {}
    for line in lines[2:]:
        row = parse_row(line) or []
        if len(row) != column_count:
            findings.add("source-u-seed-row", f"seed row has the wrong number of cells: {line}")
            continue
        seed_id = row[0]
        if not seed_id:
            findings.add("source-u-seed-id", f"seed row has an empty first cell: {line}")
            continue
        if seed_id == "added":
            findings.add("source-u-seed-id", "source seed identifier 'added' is reserved")
            continue
        if seed_id in rows:
            findings.add("source-u-seed-id", f"duplicate source seed identifier {seed_id!r}")
            continue
        rows[seed_id] = line
    return rows


def extract_e_contract(matrix_text: str, findings: Findings) -> tuple[str, list[str]]:
    none_lines = re.findall(r"^E2E: none — \S.*$", matrix_text, re.MULTILINE)
    candidates: list[tuple[str, list[str]]] = []
    for block, lines in markdown_tables(matrix_text):
        ids: list[str] = []
        for line in lines[2:]:
            row = parse_row(line) or []
            if row and re.fullmatch(r"E\d+", row[0]):
                ids.append(row[0])
        if ids:
            candidates.append((block, ids))
    if len(none_lines) + len(candidates) != 1:
        findings.add("source-e-contract", "matrix must contain exactly one E table or E2E-none line")
        return "", []
    if none_lines:
        return none_lines[0], []
    block, ids = candidates[0]
    rows = markdown_tables(block)[0][1][2:]
    for line in rows:
        row = parse_row(line) or []
        if not row or not re.fullmatch(r"E\d+", row[0]):
            findings.add("source-e-row", f"E table contains a non-E data row: {line}")
        if "⬜" not in row:
            findings.add("source-e-status", f"E row {row[0] if row else '?'} lacks status ⬜")
    if len(ids) != len(set(ids)):
        findings.add("source-e-id", "source E IDs are not unique")
    return block, ids


def h2_named_sections(text: str, name: str) -> list[str]:
    headings = list(re.finditer(r"^## (?!#)(.+?)\s*$", text, re.MULTILINE))
    sections: list[str] = []
    for index, heading in enumerate(headings):
        if heading.group(1) != name:
            continue
        end = headings[index + 1].start() if index + 1 < len(headings) else len(text)
        sections.append(text[heading.end() : end])
    return sections


def structured_requirement_rows(text: str, allow_unsectioned: bool = False) -> dict[str, set[str]]:
    rows: dict[str, set[str]] = {}
    sections = h2_named_sections(text, "Requirements")
    sources = sections or ([text] if allow_unsectioned else [])
    for line in (line for section in sources for line in section.splitlines()):
        stripped = line.strip()
        if stripped.startswith("|"):
            row = parse_row(stripped) or []
            if row and re.fullmatch(r"R[1-9]\d*", row[0]):
                rows.setdefault(row[0], set()).add(line)
            continue
        stripped = re.sub(r"^(?:#{1,6}\s+|[-*]\s+)", "", stripped)
        match = re.match(r"^(R[1-9]\d*)(?=\s*(?:[.:—-]|$))", stripped)
        if match:
            rows.setdefault(match.group(1), set()).add(line)
    return rows


def structured_decision_rows(text: str) -> dict[str, set[str]]:
    rows: dict[str, set[str]] = {}
    expected = ["Question", "Decision", "Rationale", "Source"]
    for _, lines in markdown_tables(text):
        header = parse_row(lines[0]) or []
        five_column = len(header) == 5 and header[1:] == expected and header[0] in {"ID", "#"}
        legacy_three_column = header == ["ID", "Decision", "Rationale"]
        if not five_column and not legacy_three_column:
            continue
        for line in lines[2:]:
            row = parse_row(line) or []
            if len(row) != len(header):
                continue
            raw = row[0]
            if re.fullmatch(r"D[1-9]\d*", raw):
                canonical = raw
            elif five_column and header[0] == "#" and re.fullmatch(r"[1-9]\d*", raw):
                canonical = f"D{raw}"
            else:
                continue
            rows.setdefault(canonical, set()).add(line)
    return rows


def validate_surface(value: str, findings: Findings, code: str) -> tuple[str, str] | None:
    match = SURFACE_RE.fullmatch(value.strip("`"))
    if not match:
        findings.add(code, f"invalid path::symbol surface: {value!r}")
        return None
    path = match.group("path")
    if not valid_relative(path):
        findings.add(code, f"surface path is not repository-relative: {path!r}")
        return None
    return path, match.group("symbol")


def symbol_exists(repo_root: Path, surface: tuple[str, str], findings: Findings, code: str) -> None:
    relative, symbol = surface
    path = repo_root / relative
    if not path.is_file():
        findings.add(code, f"repository surface path does not exist: {relative}")
        return
    try:
        text = path.read_text(encoding="utf-8")
    except (OSError, UnicodeError):
        findings.add(code, f"repository surface is not readable UTF-8: {relative}")
        return
    token = re.split(r"[.:-]", symbol)[-1]
    if not re.search(rf"\b{re.escape(token)}\b", text):
        findings.add(code, f"symbol {symbol!r} was not found in {relative}")


def sentinel(content: str, findings: Findings, location: str) -> bool:
    value = content.strip()
    if value.lower().startswith("none"):
        if not SENTINEL_RE.fullmatch(value):
            findings.add("sentinel", f"{location} must use exact 'none — <reason>'")
        return True
    return False


def bullets(content: str, findings: Findings, location: str) -> list[str]:
    lines = [line.strip() for line in content.splitlines() if line.strip()]
    if not lines or any(not line.startswith("- ") for line in lines):
        findings.add("field-grammar", f"{location} must contain only non-empty bullets or the sentinel")
    return lines


def parse_units(
    section: str, repo_root: Path, findings: Findings
) -> tuple[dict[str, dict[str, Any]], dict[str, set[str]]]:
    matches = list(re.finditer(r"^### (?!#)(.+?)\s*$", section, re.MULTILINE))
    units: dict[str, dict[str, Any]] = {}
    ordered_ids: list[str] = []
    for index, match in enumerate(matches):
        heading = match.group(1)
        unit_match = re.fullmatch(r"Unit (I\d+) — \S.*", heading)
        if not unit_match:
            findings.add("unit-heading", f"invalid unit heading: {heading!r}")
            continue
        unit_id = unit_match.group(1)
        if unit_id in units:
            findings.add("unit-id", f"duplicate unit ID {unit_id}")
            continue
        end = matches[index + 1].start() if index + 1 < len(matches) else len(section)
        unit_body = section[match.end() : end]
        field_matches = list(re.finditer(r"^#### (?!#)(.+?)\s*$", unit_body, re.MULTILINE))
        names = [field.group(1) for field in field_matches]
        if names != UNIT_FIELDS:
            findings.add("unit-fields", f"{unit_id} expected {UNIT_FIELDS}; found {names}")
        fields: dict[str, str] = {}
        for field_index, field_match in enumerate(field_matches):
            field_end = (
                field_matches[field_index + 1].start()
                if field_index + 1 < len(field_matches)
                else len(unit_body)
            )
            value = unit_body[field_match.end() : field_end].strip()
            fields[field_match.group(1)] = value
            if not value:
                findings.add("unit-field-empty", f"{unit_id} {field_match.group(1)} is empty")
        units[unit_id] = {"fields": fields, "index": len(ordered_ids)}
        ordered_ids.append(unit_id)
    if not matches:
        findings.add("unit-missing", "Implementation Units contains no unit")
    numbers = [int(unit_id[1:]) for unit_id in ordered_ids]
    if numbers != sorted(numbers) or len(numbers) != len(set(numbers)):
        findings.add("unit-order", f"unit IDs are not unique and increasing: {ordered_ids}")

    producer_surfaces: dict[str, set[str]] = {unit_id: set() for unit_id in units}
    file_surfaces: dict[str, set[str]] = {unit_id: set() for unit_id in units}
    interface_surfaces: dict[str, set[str]] = {unit_id: set() for unit_id in units}

    for unit_id, data in units.items():
        fields = data["fields"]
        current_index = data["index"]
        for field_name, value in fields.items():
            lowered = value.lower()
            for phrase in BANNED:
                if phrase.lower() in lowered:
                    findings.add("placeholder", f"{unit_id} {field_name} contains {phrase!r}")

        dependency_value = fields.get("Dependencies", "")
        if dependency_value and not sentinel(dependency_value, findings, f"{unit_id} Dependencies"):
            for line in bullets(dependency_value, findings, f"{unit_id} Dependencies"):
                match = re.fullmatch(r"- (I\d+) — \S.*", line)
                if not match:
                    findings.add("dependency-grammar", f"{unit_id}: {line!r}")
                    continue
                dependency = match.group(1)
                if dependency not in units or units[dependency]["index"] >= current_index:
                    findings.add("dependency-order", f"{unit_id} depends on non-earlier {dependency}")

        consumes_value = fields.get("Consumes", "")
        if consumes_value and not sentinel(consumes_value, findings, f"{unit_id} Consumes"):
            for line in bullets(consumes_value, findings, f"{unit_id} Consumes"):
                cleaned = line.replace("`", "")
                match = re.fullmatch(r"- (\S+::\S+) from (I\d+|repository) — \S.*", cleaned)
                if not match:
                    findings.add("consume-grammar", f"{unit_id}: {line!r}")
                    continue
                parsed = validate_surface(match.group(1), findings, "consume-surface")
                if not parsed:
                    continue
                surface_text = f"{parsed[0]}::{parsed[1]}"
                interface_surfaces[unit_id].add(surface_text)
                source = match.group(2)
                data.setdefault("consumes", []).append((surface_text, source))
                if source == "repository":
                    symbol_exists(repo_root, parsed, findings, "consume-repository")
                elif source not in units or units[source]["index"] >= current_index:
                    findings.add("consume-order", f"{unit_id} consumes from non-earlier {source}")

        produces_value = fields.get("Produces", "")
        if produces_value and not sentinel(produces_value, findings, f"{unit_id} Produces"):
            for line in bullets(produces_value, findings, f"{unit_id} Produces"):
                cleaned = line.replace("`", "")
                match = re.fullmatch(r"- (\S+::\S+) — \S.*", cleaned)
                if not match:
                    findings.add("produce-grammar", f"{unit_id}: {line!r}")
                    continue
                parsed = validate_surface(match.group(1), findings, "produce-surface")
                if parsed:
                    surface_text = f"{parsed[0]}::{parsed[1]}"
                    producer_surfaces[unit_id].add(surface_text)
                    interface_surfaces[unit_id].add(surface_text)

        files_value = fields.get("Files", "")
        if files_value and not sentinel(files_value, findings, f"{unit_id} Files"):
            for line in bullets(files_value, findings, f"{unit_id} Files"):
                cleaned = line.replace("`", "")
                match = re.fullmatch(r"- (Create|Modify|Delete) (\S+::\S+) — \S.*", cleaned)
                if not match:
                    findings.add("file-grammar", f"{unit_id}: {line!r}")
                    continue
                parsed = validate_surface(match.group(2), findings, "file-surface")
                if not parsed:
                    continue
                surface_text = f"{parsed[0]}::{parsed[1]}"
                file_surfaces[unit_id].add(surface_text)
                operation = match.group(1)
                path = repo_root / parsed[0]
                if operation in {"Modify", "Delete"} and not path.is_file():
                    findings.add("file-existing", f"{unit_id} {operation} path does not exist: {parsed[0]}")
                if operation == "Create" and path.exists():
                    findings.add("file-create", f"{unit_id} Create path already exists: {parsed[0]}")

        patterns_value = fields.get("Patterns", "")
        if patterns_value and not sentinel(patterns_value, findings, f"{unit_id} Patterns"):
            for line in bullets(patterns_value, findings, f"{unit_id} Patterns"):
                match = SURFACE_RE.search(line)
                if not match:
                    findings.add("pattern-grammar", f"{unit_id}: {line!r}")
                    continue
                symbol_exists(
                    repo_root,
                    (match.group("path"), match.group("symbol")),
                    findings,
                    "pattern-repository",
                )

        for produced in producer_surfaces[unit_id]:
            if produced not in file_surfaces[unit_id]:
                findings.add("produce-file", f"{unit_id} produced surface is absent from Files: {produced}")

    for unit_id, data in units.items():
        for surface_text, source in data.get("consumes", []):
            if source != "repository" and source in producer_surfaces:
                if surface_text not in producer_surfaces[source]:
                    findings.add(
                        "consume-producer",
                        f"{unit_id} consumes {surface_text} from {source}, which does not produce it",
                    )
    owned_surfaces = {
        unit_id: file_surfaces[unit_id] | interface_surfaces[unit_id] for unit_id in units
    }
    return units, owned_surfaces


def validate_ledger(
    ledger: Any,
    source_paths: dict[str, tuple[str, Path] | None],
    source_texts: dict[str, str],
    e_contract: str,
    source_seed_rows: dict[str, str],
    findings: Findings,
) -> tuple[set[str], set[str], set[str]]:
    if not isinstance(ledger, dict) or ledger.get("version") != 1:
        findings.add("ledger-version", "source ledger must be a version-1 object")
        return set(), set(), set()
    sources = ledger.get("sources")
    hashes = ledger.get("source_sha256")
    if not isinstance(sources, dict) or not isinstance(hashes, dict):
        findings.add("ledger-sources", "ledger sources and source_sha256 must be objects")
        return set(), set(), set()
    expected_source_values = {
        key: value[0] if value else None for key, value in source_paths.items()
    }
    if sources != expected_source_values:
        findings.add("ledger-sources", f"ledger sources do not match CLI sources: {expected_source_values}")
    expected_hash_keys = {value[0] for value in source_paths.values() if value}
    if set(hashes) != expected_hash_keys:
        findings.add("ledger-hashes", f"source_sha256 keys must be {sorted(expected_hash_keys)}")
    for key, value in source_paths.items():
        if not value:
            continue
        source_id, path = value
        actual = sha256(path)
        if hashes.get(source_id) != actual:
            findings.add("source-hash", f"hash mismatch for {source_id}")

    valid_source_ids = {value[0] for value in source_paths.values() if value}

    def entries(name: str, pattern: str, allow_sources: set[str]) -> tuple[set[str], list[dict[str, Any]]]:
        raw = ledger.get(name)
        if not isinstance(raw, list):
            findings.add(f"ledger-{name}", f"{name} must be a list")
            return set(), []
        ids: set[str] = set()
        accepted: list[dict[str, Any]] = []
        for item in raw:
            if not isinstance(item, dict):
                findings.add(f"ledger-{name}", f"{name} entry must be an object")
                continue
            entry_id = item.get("id")
            source = item.get("source")
            exact = item.get("exact")
            if not isinstance(entry_id, str) or not re.fullmatch(pattern, entry_id):
                findings.add(f"ledger-{name}", f"invalid ID {entry_id!r}")
                continue
            if entry_id in ids:
                findings.add(f"ledger-{name}", f"duplicate ID {entry_id}")
            ids.add(entry_id)
            if source not in allow_sources:
                findings.add(f"ledger-{name}", f"{entry_id} has unknown source {source!r}")
            if not isinstance(exact, str) or not exact or exact not in source_texts.get(source, ""):
                findings.add(f"ledger-{name}", f"{entry_id} exact value is absent from {source!r}")
            accepted.append(item)
        return ids, accepted

    requirement_ids, requirement_entries = entries("requirements", r"R[1-9]\d*", valid_source_ids)
    decision_ids, decision_entries = entries("decisions", r"D[1-9]\d*", valid_source_ids)

    discovered_requirement_rows: dict[tuple[str, str], set[str]] = {}
    for key in ("decision_log", "spec", "request"):
        value = source_paths.get(key)
        if value:
            source_id = value[0]
            found = structured_requirement_rows(
                source_texts[source_id], allow_unsectioned=key == "request"
            )
            for requirement, exact_rows in found.items():
                discovered_requirement_rows[(source_id, requirement)] = exact_rows
    discovered_requirements = {item[1] for item in discovered_requirement_rows}
    if requirement_ids != discovered_requirements:
        findings.add(
            "source-requirements",
            f"ledger requirements {sorted(requirement_ids)} != source requirements {sorted(discovered_requirements)}",
        )
    for item in requirement_entries:
        key = (item.get("source"), item.get("id"))
        if item.get("exact") not in discovered_requirement_rows.get(key, set()):
            findings.add("source-requirement-row", f"{item.get('id')} exact value is not its structured requirement row")

    discovered_decision_rows: dict[tuple[str, str], set[str]] = {}
    decision_source = source_paths.get("decision_log")
    if decision_source:
        source_id = decision_source[0]
        for decision, exact_rows in structured_decision_rows(source_texts[source_id]).items():
            discovered_decision_rows[(source_id, decision)] = exact_rows
    discovered_decisions = {item[1] for item in discovered_decision_rows}
    if decision_ids != discovered_decisions:
        findings.add(
            "source-decisions",
            f"ledger decisions {sorted(decision_ids)} != source decisions {sorted(discovered_decisions)}",
        )
    for item in decision_entries:
        key = (item.get("source"), item.get("id"))
        if item.get("exact") not in discovered_decision_rows.get(key, set()):
            findings.add("source-decision-row", f"{item.get('id')} exact value is not its structured decision row")

    raw_seeds = ledger.get("u_seeds")
    seed_ids: set[str] = set()
    if not isinstance(raw_seeds, list):
        findings.add("ledger-u-seeds", "u_seeds must be a list")
    else:
        for item in raw_seeds:
            if not isinstance(item, dict):
                findings.add("ledger-u-seeds", "u_seeds entry must be an object")
                continue
            seed_id = item.get("id")
            exact = item.get("exact")
            if not isinstance(seed_id, str) or not seed_id or seed_id == "added":
                findings.add("ledger-u-seeds", f"invalid seed ID {seed_id!r}")
                continue
            if seed_id in seed_ids:
                findings.add("ledger-u-seeds", f"duplicate seed ID {seed_id}")
            seed_ids.add(seed_id)
            source_exact = source_seed_rows.get(seed_id)
            if not isinstance(exact, str) or source_exact is None or exact != source_exact:
                findings.add("ledger-u-seeds", f"{seed_id} does not preserve its exact source table row")
    discovered_seeds = set(source_seed_rows)
    if seed_ids != discovered_seeds:
        findings.add(
            "source-seeds",
            f"ledger seeds {sorted(seed_ids)} != matrix seeds {sorted(discovered_seeds)}",
        )

    ledger_e = ledger.get("e_contract")
    if not isinstance(ledger_e, dict) or ledger_e.get("exact") != e_contract:
        findings.add("ledger-e-contract", "ledger E contract is not the exact source E block")
    return requirement_ids, decision_ids, seed_ids


def validate_requirements(
    section: str,
    requirement_ids: set[str],
    units: dict[str, dict[str, Any]],
    findings: Findings,
) -> None:
    lines = [line.strip() for line in section.splitlines() if line.strip()]
    expected = ["| Requirement | Owning units |", "|---|---|"]
    if lines[:2] != expected:
        findings.add("requirements-header", f"expected exact header {expected}")
        return
    table_owners: dict[str, set[str]] = {}
    for line in lines[2:]:
        row = parse_row(line)
        if not row:
            break
        if len(row) != 2 or not re.fullmatch(r"R\d+", row[0]):
            findings.add("requirements-row", f"invalid row: {line}")
            continue
        requirement = row[0]
        if requirement in table_owners:
            findings.add("requirements-duplicate", f"duplicate {requirement}")
        owners = {item.strip() for item in row[1].split(",") if item.strip()}
        if not owners or any(owner not in units for owner in owners):
            findings.add("requirements-owner", f"{requirement} has unknown or empty owners: {sorted(owners)}")
        table_owners[requirement] = owners
    if set(table_owners) != requirement_ids:
        findings.add(
            "requirements-completeness",
            f"plan requirements {sorted(table_owners)} != ledger requirements {sorted(requirement_ids)}",
        )
    unit_owners: dict[str, set[str]] = {requirement: set() for requirement in requirement_ids}
    for unit_id, data in units.items():
        value = data["fields"].get("Requirements", "")
        if not value or sentinel(value, findings, f"{unit_id} Requirements"):
            continue
        ids = set(re.findall(r"\bR\d+\b", value))
        unknown = ids - requirement_ids
        if unknown:
            findings.add("unit-requirement", f"{unit_id} names unknown requirements {sorted(unknown)}")
        for requirement in ids & requirement_ids:
            unit_owners[requirement].add(unit_id)
    for requirement in requirement_ids:
        if table_owners.get(requirement, set()) != unit_owners.get(requirement, set()):
            findings.add(
                "requirements-bidirectional",
                f"{requirement} table owners {sorted(table_owners.get(requirement, set()))} "
                f"!= unit owners {sorted(unit_owners.get(requirement, set()))}",
            )


def find_exact_table(section: str, header: str, separator: str) -> tuple[list[list[str]], int]:
    needle = f"{header}\n{separator}"
    start = section.find(needle)
    if start < 0:
        return [], -1
    lines = section[start:].splitlines()
    rows: list[list[str]] = []
    for line in lines[2:]:
        parsed = parse_row(line)
        if parsed is None:
            break
        rows.append(parsed)
    return rows, start


def validate_test_matrix(
    section: str,
    source_e: str,
    e_ids: list[str],
    seed_ids: set[str],
    units: dict[str, dict[str, Any]],
    owned_surfaces: dict[str, set[str]],
    findings: Findings,
) -> None:
    if section.count(source_e) != 1:
        findings.add("e-verbatim", "plan must contain the exact source E contract once")
    e_position = section.find(source_e)
    u_header = "| ID | Owner | Seed | Surface | Scenario | Status |"
    u_separator = "|---|---|---|---|---|---|"
    u_rows, u_position = find_exact_table(section, u_header, u_separator)
    if u_position < 0:
        findings.add("u-header", "missing exact U table header")
    dropped_heading = "### Dropped Seeds"
    dropped_position = section.find(dropped_heading)
    if min(e_position, u_position, dropped_position) < 0 or not (e_position < u_position < dropped_position):
        findings.add("matrix-order", "E contract, U table, and Dropped Seeds must appear in order")
    if section.count(u_header) != 1:
        findings.add("u-header", "U table header must occur exactly once")
    if section.count(dropped_heading) != 1:
        findings.add("dropped-heading", "Dropped Seeds heading must occur exactly once")

    u_by_id: dict[str, tuple[str, str]] = {}
    mapped_seeds: list[str] = []
    for row in u_rows:
        if len(row) != 6:
            findings.add("u-row", f"U row must have six cells: {row}")
            continue
        u_id, owner, seed, surface_text, scenario, status = row
        if not re.fullmatch(r"U\d+", u_id):
            findings.add("u-id", f"invalid U ID {u_id!r}")
            continue
        if u_id in u_by_id:
            findings.add("u-id", f"duplicate U ID {u_id}")
        if owner not in units:
            findings.add("u-owner", f"{u_id} has unknown owner {owner!r}")
        if seed != "added" and seed not in seed_ids:
            findings.add("u-seed", f"{u_id} has unknown seed {seed!r}")
        if seed != "added":
            mapped_seeds.append(seed)
        parsed = validate_surface(surface_text, findings, "u-surface")
        normalized = f"{parsed[0]}::{parsed[1]}" if parsed else surface_text
        if owner in owned_surfaces and normalized not in owned_surfaces[owner]:
            findings.add("u-surface-owner", f"{u_id} surface is not owned by {owner}: {normalized}")
        if scenario.count("→") != 2 or any(phrase.lower() in scenario.lower() for phrase in BANNED):
            findings.add("u-scenario", f"{u_id} must use concrete input → action → expected result")
        if status != "☐":
            findings.add("u-status", f"{u_id} status must be ☐")
        u_by_id[u_id] = (owner, seed)

    dropped_header = "| Seed | Reason |"
    dropped_separator = "|---|---|"
    dropped_section = section[dropped_position:] if dropped_position >= 0 else ""
    dropped_rows, local_position = find_exact_table(dropped_section, dropped_header, dropped_separator)
    if local_position < 0:
        findings.add("dropped-header", "missing exact Dropped Seeds table header")
    dropped_seeds: list[str] = []
    for row in dropped_rows:
        if len(row) != 2 or row[0] not in seed_ids or not row[1]:
            findings.add("dropped-row", f"invalid Dropped Seeds row: {row}")
            continue
        dropped_seeds.append(row[0])
    if len(mapped_seeds) != len(set(mapped_seeds)):
        findings.add("seed-mapped-once", "a source seed maps to more than one U row")
    if len(dropped_seeds) != len(set(dropped_seeds)):
        findings.add("seed-dropped-once", "a source seed is dropped more than once")
    if set(mapped_seeds) & set(dropped_seeds):
        findings.add("seed-both", "a source seed is both mapped and dropped")
    if set(mapped_seeds) | set(dropped_seeds) != seed_ids:
        findings.add("seed-completeness", "every source seed must be mapped or dropped exactly once")

    scenario_owners: dict[str, list[str]] = {}
    e_coverage: set[str] = set()
    for unit_id, data in units.items():
        test_value = data["fields"].get("Test scenarios", "")
        if test_value and not sentinel(test_value, findings, f"{unit_id} Test scenarios"):
            ids = re.findall(r"\bU\d+\b", test_value)
            if not ids:
                findings.add("unit-u-coverage", f"{unit_id} has no U row")
            for u_id in ids:
                scenario_owners.setdefault(u_id, []).append(unit_id)
        e_value = data["fields"].get("E rows", "")
        if e_value and not sentinel(e_value, findings, f"{unit_id} E rows"):
            ids = set(re.findall(r"\bE\d+\b", e_value))
            unknown = ids - set(e_ids)
            if unknown:
                findings.add("unit-e-id", f"{unit_id} names unknown E rows {sorted(unknown)}")
            e_coverage |= ids

    for u_id, (owner, _) in u_by_id.items():
        named = scenario_owners.get(u_id, [])
        if named != [owner]:
            findings.add("u-bidirectional", f"{u_id} table owner {owner} != unit references {named}")
    unknown_u = set(scenario_owners) - set(u_by_id)
    if unknown_u:
        findings.add("unit-u-id", f"unit fields name unknown U rows {sorted(unknown_u)}")
    if e_ids and e_coverage != set(e_ids):
        findings.add("e-coverage", f"covered E rows {sorted(e_coverage)} != source E rows {sorted(e_ids)}")
    if not e_ids:
        for unit_id, data in units.items():
            value = data["fields"].get("E rows", "")
            if value and not sentinel(value, findings, f"{unit_id} E rows"):
                findings.add("e-none", f"{unit_id} must use sentinel when source declares E2E none")
    if any(status in section for status in ("☑", "✅", "❌")):
        findings.add("matrix-status", "plan contains a downstream-only Test Matrix status")


def validate_decisions(decision_ids: set[str], units: dict[str, dict[str, Any]], findings: Findings) -> None:
    traced: set[str] = set()
    for unit_id, data in units.items():
        value = data["fields"].get("Decision trace", "")
        if not value or sentinel(value, findings, f"{unit_id} Decision trace"):
            continue
        ids = set(re.findall(r"\bD\d+\b", value))
        unknown = ids - decision_ids
        if unknown:
            findings.add("decision-id", f"{unit_id} names unknown decisions {sorted(unknown)}")
        traced |= ids
    if traced & decision_ids != decision_ids:
        findings.add("decision-completeness", f"untraced decisions: {sorted(decision_ids - traced)}")


def validate_manifest(repo_root: Path, plan_relative: str, manifest_path: Path, findings: Findings) -> None:
    manifest = read_json(manifest_path, findings, "manifest")
    if not isinstance(manifest, dict) or manifest.get("version") != 1 or not isinstance(manifest.get("files"), dict):
        findings.add("manifest", "pre-run manifest must be a version-1 object with files")
        return
    before = manifest["files"]
    if plan_relative in before:
        findings.add("plan-new", "plan existed in the pre-run manifest")
    current = inventory(repo_root, {plan_relative})
    if current != before:
        missing = sorted(set(before) - set(current))
        extra = sorted(set(current) - set(before))
        changed = sorted(path for path in set(before) & set(current) if before[path] != current[path])
        findings.add(
            "repository-mutation",
            f"missing={missing}, extra={extra}, changed={changed}; only the new plan is allowed",
        )


def validate_plan(args: argparse.Namespace) -> int:
    findings = Findings()
    repo_root = Path(args.repo_root).resolve()
    if not repo_root.is_dir():
        findings.add("repo-root", f"not a directory: {repo_root}")
        return findings.emit()
    plan_path = Path(args.plan).resolve()
    if not plan_path.is_file() or not is_within(plan_path, repo_root):
        findings.add("plan-path", "plan must be an existing file inside repository root")
        return findings.emit()
    plan_relative = plan_path.relative_to(repo_root).as_posix()
    path_match = PLAN_PATH_RE.fullmatch(plan_relative)
    if not path_match:
        findings.add("plan-filename", f"invalid plan path: {plan_relative}")

    source_paths: dict[str, tuple[str, Path] | None] = {}
    for key in ("matrix", "decision_log", "spec"):
        raw = getattr(args, key)
        if raw is None:
            source_paths[key] = None
            continue
        if not valid_relative(raw):
            findings.add("source-path", f"{key} must be repository-relative: {raw!r}")
            source_paths[key] = None
            continue
        path = repo_root / raw
        if not path.is_file():
            findings.add("source-path", f"{key} does not exist: {raw}")
            source_paths[key] = None
            continue
        source_paths[key] = (raw, path)
    if source_paths.get("matrix") is None:
        findings.add("source-matrix", "an original matrix is required")

    if args.request_source:
        request_path = Path(args.request_source).resolve()
        if not request_path.is_file():
            findings.add("request-source", f"request source does not exist: {request_path}")
            source_paths["request"] = None
        else:
            source_paths["request"] = ("direct_request", request_path)
    else:
        source_paths["request"] = None

    source_texts: dict[str, str] = {}
    for value in source_paths.values():
        if not value:
            continue
        source_id, path = value
        try:
            source_texts[source_id] = path.read_text(encoding="utf-8")
        except (OSError, UnicodeError) as exc:
            findings.add("source-read", f"cannot read {source_id}: {exc}")

    matrix_value = source_paths.get("matrix")
    matrix_text = source_texts.get(matrix_value[0], "") if matrix_value else ""
    source_e, e_ids = extract_e_contract(matrix_text, findings)
    source_seed_rows = extract_u_seed_rows(matrix_text, findings)
    ledger = read_json(Path(args.source_ledger), findings, "ledger")
    requirement_ids, decision_ids, seed_ids = validate_ledger(
        ledger, source_paths, source_texts, source_e, source_seed_rows, findings
    )

    try:
        text = plan_path.read_text(encoding="utf-8")
    except (OSError, UnicodeError) as exc:
        findings.add("plan-read", f"cannot read plan: {exc}")
        return findings.emit()
    frontmatter, body = parse_frontmatter(text, findings)
    if path_match:
        filename_date, _, filename_type, _ = path_match.groups()
        try:
            date.fromisoformat(filename_date)
        except ValueError:
            findings.add("plan-date", f"invalid filename date {filename_date}")
        if frontmatter.get("date") != filename_date:
            findings.add("plan-date", "frontmatter date does not match filename")
        if frontmatter.get("type") != filename_type:
            findings.add("plan-type", "frontmatter type does not match filename")
    if frontmatter.get("status") not in {"active", "approved"}:
        findings.add("plan-status", "frontmatter status must be active or approved")
    decision_value = source_paths.get("decision_log")
    if decision_value:
        if frontmatter.get("decisions") != decision_value[0]:
            findings.add("plan-decisions", "frontmatter decisions must name the supplied decision log")
    elif not SENTINEL_RE.fullmatch(frontmatter.get("decisions", "")):
        findings.add("plan-decisions", "absent decision log requires exact none-sentinel")
    origin = frontmatter.get("origin", "")
    allowed_origins = {value[0] for key, value in source_paths.items() if value and key != "request"}
    if source_paths.get("request"):
        if origin != "none — converged direct request" and origin not in allowed_origins:
            findings.add("plan-origin", "direct-request origin must use the contract sentinel or a supplied source")
    elif origin not in allowed_origins:
        findings.add("plan-origin", "frontmatter origin must name a supplied source")

    sections = h2_sections(body, findings)
    units, owned_surfaces = parse_units(sections.get("Implementation Units", ""), repo_root, findings)
    validate_requirements(sections.get("Requirements Trace", ""), requirement_ids, units, findings)
    if source_e:
        validate_test_matrix(
            sections.get("Test Matrix", ""),
            source_e,
            e_ids,
            seed_ids,
            units,
            owned_surfaces,
            findings,
        )
    validate_decisions(decision_ids, units, findings)

    sources_section = sections.get("Sources & References", "")
    for key, value in source_paths.items():
        if value and key != "request" and value[0] not in sources_section:
            findings.add("sources-reference", f"Sources & References omits {value[0]}")
    if re.search(r"```(?:python|javascript|typescript|tsx|jsx|java|go|rust|ruby|bash|sh|shell)\b", body, re.IGNORECASE):
        findings.add("runnable-code", "plan contains a runnable-language code fence")
    if re.search(r"(?m)^\s*(?:\$\s*)?git\s+\S+", body):
        findings.add("git-command", "plan contains a git command")
    if re.search(r"`(?:/|[A-Za-z]:\\)[^`]+`", body):
        findings.add("absolute-path", "plan contains an absolute path")

    validate_manifest(repo_root, plan_relative, Path(args.pre_run_manifest), findings)
    return findings.emit()


def validate_blocked(path: Path) -> int:
    findings = Findings()
    try:
        artifact = path.read_bytes()
        text = artifact.decode("utf-8")
    except (OSError, UnicodeError) as exc:
        findings.add("blocked-read", f"cannot read blocker: {exc}")
        return findings.emit()
    lines = text.splitlines()
    if len(lines) != 5 or any(not line for line in lines):
        findings.add("blocked-lines", "blocker must contain exactly five non-empty lines")
        return findings.emit()
    if lines[0] != "STATUS: BLOCKED":
        findings.add("blocked-status", "line 1 must be STATUS: BLOCKED")
    reason_match = re.fullmatch(r"REASON: (PLAN_CONFLICT|MISSING_E2E)", lines[1])
    if not reason_match:
        findings.add("blocked-reason", "line 2 has an invalid reason")
    artifact_match = re.fullmatch(r"ARTIFACTS: (\S+(?:;\S+)*)", lines[2])
    if not artifact_match:
        findings.add("blocked-artifacts", "line 3 needs semicolon-separated repository-relative paths")
    else:
        for artifact_path in artifact_match.group(1).split(";"):
            if not valid_relative(artifact_path):
                findings.add("blocked-artifacts", f"invalid artifact path: {artifact_path!r}")
    owner_match = re.fullmatch(r"OWNER: (product-design|test-design)", lines[3])
    if not owner_match:
        findings.add("blocked-owner", "line 4 has an invalid owner")
    if reason_match and owner_match:
        expected = "product-design" if reason_match.group(1) == "PLAN_CONFLICT" else "test-design"
        if owner_match.group(1) != expected:
            findings.add("blocked-owner-map", f"{reason_match.group(1)} requires owner {expected}")
    if not HAN_RE.search(lines[4]) or len(lines[4]) > 120:
        findings.add("blocked-explanation", "line 5 must be concise Chinese text")
    if findings.items:
        return findings.emit()
    sys.stdout.buffer.write(artifact)
    return 0


def snapshot(args: argparse.Namespace) -> int:
    findings = Findings()
    repo_root = Path(args.repo_root).resolve()
    output = Path(args.output).resolve()
    if not repo_root.is_dir():
        findings.add("repo-root", f"not a directory: {repo_root}")
        return findings.emit()
    if is_within(output, repo_root):
        findings.add("manifest-location", "manifest must be outside repository root")
        return findings.emit()
    payload = {"version": 1, "files": inventory(repo_root)}
    try:
        output.parent.mkdir(parents=True, exist_ok=True)
        output.write_text(json.dumps(payload, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    except OSError as exc:
        findings.add("manifest-write", f"cannot write manifest: {exc}")
        return findings.emit()
    print(f"PASS: wrote {len(payload['files'])} entries to {output}")
    return 0


def parser() -> argparse.ArgumentParser:
    root = argparse.ArgumentParser(description=__doc__)
    subcommands = root.add_subparsers(dest="command", required=True)

    snapshot_parser = subcommands.add_parser("snapshot", help="write a pre-authoring repository manifest")
    snapshot_parser.add_argument("--repo-root", required=True)
    snapshot_parser.add_argument("--output", required=True)
    snapshot_parser.set_defaults(run=snapshot)

    check_parser = subcommands.add_parser("check", help="validate a completed plan")
    check_parser.add_argument("plan")
    check_parser.add_argument("--repo-root", required=True)
    check_parser.add_argument("--pre-run-manifest", required=True)
    check_parser.add_argument("--matrix", required=True)
    check_parser.add_argument("--source-ledger", required=True)
    check_parser.add_argument("--decision-log")
    check_parser.add_argument("--spec")
    check_parser.add_argument("--request-source")
    check_parser.set_defaults(run=validate_plan)

    blocked_parser = subcommands.add_parser("check-blocked", help="validate the five-line blocked result")
    blocked_parser.add_argument("artifact", type=Path)
    blocked_parser.set_defaults(run=lambda args: validate_blocked(args.artifact))
    return root


def main() -> None:
    args = parser().parse_args()
    raise SystemExit(args.run(args))


if __name__ == "__main__":
    main()
