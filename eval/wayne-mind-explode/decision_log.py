#!/usr/bin/env python3
"""Sole reader for the run-scoped JSONL decision log.

Every checker parses the log through this module. The record schema it enforces
is owned by `_shared/pipeline-id-contract.md`; this file is its executable form,
not a second definition of it.
"""

from __future__ import annotations

import hashlib
import json
import re
from dataclasses import dataclass, field
from pathlib import Path, PurePosixPath
from urllib.parse import urlparse

LOG_GLOB = ".wayne/runs/*/decision-log.jsonl"
LOG_RELATIVE = re.compile(r"(?:^|/)\.wayne/runs/[^/]+/decision-log\.jsonl$")

DECISION_ID = re.compile(r"^D([1-9]\d*)$")
NODE_ID = re.compile(r"^N([1-9]\d*)$")
SLUG = re.compile(r"^[a-z0-9]+(?:-[a-z0-9]+)*$")
LIVING_SPEC = re.compile(r"docs/specs/(?!\d{4}-\d{2}-\d{2}-)[^/]+(?<!-design)\.md")
EXTERNAL_DECISION = re.compile(r"^([a-z0-9]+(?:-[a-z0-9]+)*):D[1-9]\d*$")

# `source` values that already locate their own answer; everything else must say
# where it came from.
SELF_LOCATING = {"user", "constraint", "default"}


def is_url(value: object) -> bool:
    parsed = urlparse(str(value))
    return parsed.scheme in {"http", "https"} and bool(parsed.netloc)

SOURCES = {"user", "codebase", "web", "constraint", "default", "review"}
STATUSES = {"blocked", "open", "resolved", "not-applicable"}
KINDS = {"fact", "choice"}
META_STATUSES = {"in-progress", "design-approved"}

# Required string fields that carry meaning: an empty one is a silent hole, not a
# recorded answer. `null` is how a record says "no value".
NON_EMPTY = {
    "meta": ("topic", "status"),
    "decision": ("id", "question", "decision", "rationale", "source"),
    "node": ("id", "kind", "decision", "status"),
}


def SAFE_RELATIVE(value: str) -> bool:
    """A repository-relative path that cannot escape the repository."""
    if not value or value.startswith(("/", "~")):
        return False
    return ".." not in PurePosixPath(value).parts


SCHEMA: dict[str, dict[str, type | tuple[type, ...]]] = {
    "meta": {
        "type": str,
        "topic": str,
        "status": str,
        "spec": (str, type(None)),
        "test_matrix": (str, type(None)),
        "frontier_locked": bool,
        "written_spec_approved": bool,
        "approved_spec_sha256": (str, type(None)),
    },
    "decision": {
        "type": str,
        "id": str,
        "question": str,
        "decision": str,
        "rationale": str,
        "consequences": (str, type(None)),
        "supersedes": list,
        "source": str,
        "reference": (str, type(None)),
    },
    "node": {
        "type": str,
        "id": str,
        "parent": (str, type(None)),
        "kind": str,
        "decision": str,
        "status": str,
        "opens_when": (str, type(None)),
        "resolved_by": (str, type(None)),
    },
}


def dumps(record: dict[str, object]) -> str:
    """Serialize one record exactly as a producer must write it."""
    return json.dumps(record, ensure_ascii=False, separators=(",", ":"))


def dump(records: list[dict[str, object]]) -> str:
    return "".join(f"{dumps(record)}\n" for record in records)


@dataclass
class Log:
    path: Path
    meta: dict[str, object] = field(default_factory=dict)
    decisions: list[dict[str, object]] = field(default_factory=list)
    nodes: dict[str, dict[str, object]] = field(default_factory=dict)

    @property
    def topic_dir(self) -> Path:
        return self.path.parent

    def decision_ids(self) -> list[int]:
        return [
            int(match.group(1))
            for record in self.decisions
            if (match := DECISION_ID.match(str(record.get("id", ""))))
        ]

    def node_numbers(self) -> dict[int, dict[str, object]]:
        return {
            int(match.group(1)): record
            for identifier, record in self.nodes.items()
            if (match := NODE_ID.match(identifier))
        }

    def status_of(self, identifier: str) -> str:
        return str(self.nodes.get(identifier, {}).get("status", "")).casefold()

    def sources(self) -> list[str]:
        return [str(record.get("source", "")).casefold() for record in self.decisions]


def find_log(repo: Path, findings: list[str]) -> Path | None:
    matches = sorted(repo.glob(LOG_GLOB))
    if len(matches) != 1:
        findings.append(
            f"expected exactly one decision log; found={[p.relative_to(repo).as_posix() for p in matches]}"
        )
        return None
    return matches[0]


def load(path: Path, findings: list[str], repo: Path | None = None) -> Log:
    """Parse and structurally validate one decision log."""
    log = Log(path=path)
    try:
        raw = path.read_text(encoding="utf-8")
    except OSError as error:
        findings.append(f"decision log unreadable: {type(error).__name__}")
        return log

    metas = 0
    for number, line in enumerate(raw.splitlines(), 1):
        if not line.strip():
            findings.append(f"decision log line {number} is blank")
            continue
        try:
            record = json.loads(line)
        except json.JSONDecodeError as error:
            findings.append(f"decision log line {number} is not JSON: {error.msg}")
            continue
        if not isinstance(record, dict):
            findings.append(f"decision log line {number} is not an object")
            continue
        # Compact means no gratuitous whitespace, not a particular escaping of
        # non-ASCII text: both spellings are the same compact JSON object.
        if len(line) != len(dumps(record)) and len(line) != len(
            json.dumps(record, ensure_ascii=True, separators=(",", ":"))
        ):
            findings.append(f"decision log line {number} is not compact JSON")

        kind = record.get("type")
        if kind not in SCHEMA:
            findings.append(f"decision log line {number} has unknown type={kind!r}")
            continue

        expected = SCHEMA[kind]
        missing = sorted(set(expected) - set(record))
        extra = sorted(set(record) - set(expected))
        if missing:
            findings.append(f"{kind} record on line {number} omits {missing}")
        if extra:
            findings.append(f"{kind} record on line {number} has unknown keys {extra}")
        for key, types in expected.items():
            if key in record and not isinstance(record[key], types):
                findings.append(
                    f"{kind} record on line {number} field {key!r} has type "
                    f"{type(record[key]).__name__}"
                )
        for key in NON_EMPTY[kind]:
            value = record.get(key)
            if isinstance(value, str) and not value.strip():
                findings.append(f"{kind} record on line {number} field {key!r} is empty")

        if kind == "meta":
            metas += 1
            if number != 1:
                findings.append(f"meta record must be the first line; found on line {number}")
            if metas > 1:
                findings.append(f"decision log has {metas} meta records")
            else:
                log.meta = record
            if record.get("status") not in META_STATUSES:
                findings.append(f"meta.status={record.get('status')!r} is not a lifecycle value")
        elif kind == "decision":
            identifier = str(record.get("id", ""))
            if not DECISION_ID.match(identifier):
                findings.append(f"decision id {identifier!r} is not D<number>")
            if str(record.get("source", "")).casefold() not in SOURCES:
                findings.append(f"decision {identifier} has invalid source={record.get('source')!r}")
            for reference in record.get("supersedes", []) or []:
                citation = str(reference)
                superseded = EXTERNAL_DECISION.match(citation)
                if superseded:
                    if repo is not None:
                        trust_external(
                            repo, superseded.group(1), citation.split(":D", 1)[1],
                            f"decision {identifier} supersedes", findings,
                        )
                elif not DECISION_ID.match(citation):
                    findings.append(f"decision {identifier} supersedes malformed {reference!r}")
            provenance = record.get("reference")
            source = str(record.get("source", "")).casefold()
            if provenance is not None and not (
                is_url(provenance)
                or EXTERNAL_DECISION.match(str(provenance))
                or SAFE_RELATIVE(str(provenance))
            ):
                findings.append(f"decision {identifier} reference is not locatable: {provenance!r}")
            if source == "web" and not is_url(provenance):
                findings.append(f"web decision {identifier} carries no source URL")
            if source not in SELF_LOCATING and provenance is None:
                findings.append(f"{source} decision {identifier} does not locate its answer")
            if repo is not None and isinstance(provenance, str):
                external_ref = EXTERNAL_DECISION.match(provenance)
                if external_ref:
                    trust_external(
                        repo, external_ref.group(1), provenance.split(":D", 1)[1],
                        f"decision {identifier}", findings,
                    )
                elif not is_url(provenance) and SAFE_RELATIVE(provenance):
                    target = (repo / provenance).resolve()
                    if repo.resolve() not in target.parents or not target.is_file():
                        findings.append(
                            f"decision {identifier} references a path that does not exist: {provenance}"
                        )
            log.decisions.append(record)
        else:
            identifier = str(record.get("id", ""))
            if not NODE_ID.match(identifier):
                findings.append(f"node id {identifier!r} is not N<number>")
            if str(record.get("kind", "")).casefold() not in KINDS:
                findings.append(f"node {identifier} has invalid kind={record.get('kind')!r}")
            if str(record.get("status", "")).casefold() not in STATUSES:
                findings.append(f"node {identifier} has invalid status={record.get('status')!r}")
            if identifier in log.nodes:
                findings.append(f"duplicate node id {identifier}")
            log.nodes[identifier] = record

    if metas == 0:
        findings.append("decision log has no meta record")

    identifiers = log.decision_ids()
    if not identifiers:
        # A log seeded before the first branch legitimately holds only `meta`.
        if str(log.meta.get("status", "")) == "design-approved":
            findings.append("approved decision log has no decision records")
    elif identifiers != list(range(identifiers[0], identifiers[0] + len(identifiers))):
        findings.append(f"decision ids must be unique and consecutive: {identifiers}")

    order = {identifier: index for index, identifier in enumerate(log.nodes)}
    known = set(log.nodes)
    resolved_ids = {str(record.get("id")) for record in log.decisions}
    for identifier, record in log.nodes.items():
        parent = record.get("parent")
        if parent is not None:
            if str(parent) == identifier:
                findings.append(f"node {identifier} is its own parent")
            elif str(parent) not in known:
                findings.append(f"node {identifier} parent={parent!r} does not exist")
            elif order[str(parent)] > order[identifier]:
                findings.append(f"node {identifier} precedes its parent {parent}")
        resolved_by = record.get("resolved_by")
        status = str(record.get("status", "")).casefold()
        if resolved_by is not None:
            citation = str(resolved_by)
            external = EXTERNAL_DECISION.match(citation)
            if external:
                if repo is not None:
                    trust_external(
                        repo, external.group(1), citation.split(":D", 1)[1],
                        f"node {identifier}", findings,
                    )
            elif not DECISION_ID.match(citation):
                findings.append(f"node {identifier} resolved_by={resolved_by!r} is malformed")
            elif citation not in resolved_ids:
                findings.append(f"node {identifier} resolved_by={resolved_by!r} does not exist")
        if status == "resolved" and resolved_by is None:
            findings.append(f"resolved node {identifier} has no resolved_by")
        if status != "resolved" and resolved_by is not None:
            findings.append(f"{status} node {identifier} carries resolved_by={resolved_by!r}")

    for identifier in log.nodes:
        seen = {identifier}
        cursor = log.nodes[identifier].get("parent")
        while isinstance(cursor, str) and cursor in log.nodes:
            if cursor in seen:
                findings.append(f"node {identifier} sits on a parent cycle through {cursor}")
                break
            seen.add(cursor)
            cursor = log.nodes[cursor].get("parent")

    if log.meta:
        # Turn snapshots are copied out of the run directory; only an in-place log
        # can be checked against the directory that names its topic.
        if LOG_RELATIVE.search(path.as_posix()) and str(log.meta.get("topic", "")) != path.parent.name:
            findings.append(
                f"meta.topic={log.meta.get('topic')!r} does not match its run directory"
                f" {path.parent.name!r}"
            )
        locked = bool(log.meta.get("frontier_locked"))
        approved = bool(log.meta.get("written_spec_approved"))
        digest = log.meta.get("approved_spec_sha256")
        if approved and not (isinstance(digest, str) and re.fullmatch(r"[0-9a-f]{64}", digest)):
            findings.append("approved spec carries no approved digest")
        if digest is not None and not approved:
            findings.append("unapproved spec carries an approval digest")
        if not SLUG.match(str(log.meta.get("topic", ""))):
            findings.append(f"meta.topic={log.meta.get('topic')!r} is not a slug")
        if approved and not locked:
            findings.append("written spec approved while the frontier is unlocked")
        if str(log.meta.get("status", "")) == "design-approved" and not (locked and approved):
            findings.append("design-approved without a locked frontier and an approved spec")
        if locked:
            unresolved = sorted(
                node_id
                for node_id, node in log.nodes.items()
                if str(node.get("status", "")).casefold() not in {"resolved", "not-applicable"}
            )
            if unresolved:
                findings.append(f"frontier locked with unresolved nodes: {unresolved}")

        topic = str(log.meta.get("topic", ""))
        for key, expected in (
            ("spec", f"docs/specs/{topic}.md"),
            ("test_matrix", f".wayne/runs/{topic}/test-matrix.md"),
        ):
            value = log.meta.get(key)
            if value is None:
                continue
            if not isinstance(value, str) or not SAFE_RELATIVE(value):
                findings.append(f"meta.{key}={value!r} is not a repository-relative path")
            elif value != expected:
                findings.append(f"meta.{key}={value!r} does not belong to topic {topic!r}")

    return log


def frontmatter(text: str) -> str:
    match = re.match(r"---\n(.*?)\n---\n", text, re.DOTALL)
    return match.group(1) if match else ""


def trust_external(repo: Path, slug: str, number: str, label: str, findings: list[str]) -> None:
    """Every condition under which another spec's decision may be cited."""
    relative = f"docs/specs/{slug}.md"
    if not LIVING_SPEC.fullmatch(relative):
        findings.append(f"{label} cites a dated snapshot, not a living page: {slug}")
        return
    cited = repo / relative
    if not cited.is_file():
        findings.append(f"{label} cites a living spec that does not exist: {slug}:D{number}")
        return

    text = cited.read_text(encoding="utf-8")
    head = frontmatter(text)
    if not head:
        findings.append(f"{label} cites a spec with no frontmatter: {slug}")
        return

    status = re.findall(r"""^status:\s*['"]?([a-z-]+)['"]?\s*(?:#.*)?$""", head, re.MULTILINE)
    if status != ["stable"]:
        findings.append(f"{label} cites a spec whose status is {status}, not ['stable']: {slug}")

    decisions = re.search(r"^## Decisions\b(.*?)(?=^## |\Z)", text, re.MULTILINE | re.DOTALL)
    body = re.sub(r"(?ms)^```.*?^```", "", decisions.group(1)) if decisions else ""
    if len(re.findall(rf"^###\s+D{number}\b", body, re.MULTILINE)) != 1:
        findings.append(f"{label} cites a decision the spec does not carry: {slug}:D{number}")

    # Edited after it was last confirmed means the gate that approved it no longer
    # covers these bytes. No entries at all is "approved but never run", which is
    # the normal state of a spec this pipeline just produced, not staleness.
    # `stale_after` compares against today and belongs to review, not to a frozen
    # checker.
    generated = re.search(r"^generated:.*?\bat:\s*\"?([^\s\",}]+)", head, re.MULTILINE)
    if not generated:
        findings.append(f"{label} cites a spec with no `generated.at`: {slug}")
        return
    verified_block = re.search(r"^verified:(.*?)(?=^\w|\Z)", head, re.MULTILINE | re.DOTALL)
    confirmed = re.findall(
        r"""\bat:\s*['"]?([^\s'",}\]]+)""", verified_block.group(1) if verified_block else ""
    )
    if confirmed and max(confirmed) < generated.group(1):
        findings.append(
            f"{label} seeds from a spec edited after it was last confirmed: {slug}:D{number}"
        )


def read(repo: Path, findings: list[str]) -> Log | None:
    path = find_log(repo, findings)
    if path is None:
        return None
    return load(path, findings, repo)
