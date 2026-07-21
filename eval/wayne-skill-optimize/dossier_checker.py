"""Deterministic proof boundary for the optimizer intent dossier."""

from __future__ import annotations

import hashlib
import json
import re
import subprocess
from pathlib import Path


HEX40 = re.compile(r"[0-9a-f]{40}")
HEX64 = re.compile(r"[0-9a-f]{64}")
IDENT = re.compile(r"[A-Z][A-Za-z0-9_-]*")


def digest(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def load_object(path: Path, findings: list[str]) -> dict[str, object]:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeError, json.JSONDecodeError) as exc:
        findings.append(f"cannot read {path.name}: {exc}")
        return {}
    if not isinstance(value, dict):
        findings.append(f"{path.name} must contain one JSON object")
        return {}
    return value


def relative_path(value: object) -> Path | None:
    if not isinstance(value, str) or not value:
        return None
    path = Path(value)
    if path.is_absolute() or ".." in path.parts or "\\" in value:
        return None
    return path


def source_bytes(repo: Path, path: Path, revision: object) -> bytes | None:
    if revision == "WORKTREE":
        target = repo / path
        return target.read_bytes() if target.is_file() else None
    if not isinstance(revision, str) or not HEX40.fullmatch(revision):
        return None
    result = subprocess.run(
        ["git", "show", f"{revision}:{path.as_posix()}"],
        cwd=repo,
        capture_output=True,
        check=False,
    )
    return result.stdout if result.returncode == 0 else None


def validate_sources(
    repo: Path, ledger: dict[str, object], findings: list[str]
) -> tuple[dict[str, bytes], str]:
    raw = ledger.get("sources")
    if not isinstance(raw, list) or not raw:
        findings.append("intent-ledger sources must be a non-empty list")
        return {}, digest(b"[]")
    sources: dict[str, bytes] = {}
    canonical: list[dict[str, str]] = []
    for item in raw:
        if not isinstance(item, dict):
            findings.append("source entry must be an object")
            continue
        source_id = item.get("id")
        path = relative_path(item.get("path"))
        revision = item.get("revision")
        expected = item.get("sha256")
        if not isinstance(source_id, str) or not source_id or source_id in sources:
            findings.append(f"invalid or duplicate source id: {source_id!r}")
            continue
        if path is None or not isinstance(expected, str) or not HEX64.fullmatch(expected):
            findings.append(f"invalid source metadata: {source_id}")
            continue
        content = source_bytes(repo, path, revision)
        if content is None:
            findings.append(f"source is unreadable: {source_id}")
            continue
        actual = digest(content)
        if actual != expected:
            findings.append(f"source hash mismatch: {source_id}")
        sources[source_id] = content
        canonical.append({"id": source_id, "sha256": actual})
    encoded = json.dumps(sorted(canonical, key=lambda row: row["id"]), separators=(",", ":"))
    return sources, digest(encoded.encode())


def validate_ledger(
    repo: Path, dossier: Path, findings: list[str]
) -> tuple[dict[str, object], set[str], set[str], str]:
    path = dossier / "intent-ledger.json"
    ledger = load_object(path, findings)
    if ledger.get("version") != 1 or ledger.get("target") != "decision-builder":
        findings.append("intent-ledger version or target is invalid")
    control = ledger.get("control_commit")
    expected_control = subprocess.run(
        ["git", "rev-parse", "HEAD"],
        cwd=repo,
        capture_output=True,
        check=True,
        text=True,
    ).stdout.strip()
    if control != expected_control or not isinstance(control, str) or not HEX40.fullmatch(control):
        findings.append("intent-ledger control_commit does not match the frozen current HEAD")
    sources, source_set_hash = validate_sources(repo, ledger, findings)

    behaviors = ledger.get("behaviors")
    behavior_ids: set[str] = set()
    oracle_refs: set[str] = set()
    if not isinstance(behaviors, list) or not behaviors:
        findings.append("intent-ledger behaviors must be a non-empty list")
    else:
        for row in behaviors:
            if not isinstance(row, dict):
                findings.append("behavior row must be an object")
                continue
            behavior_id = row.get("id")
            if not isinstance(behavior_id, str) or not IDENT.fullmatch(behavior_id):
                findings.append(f"invalid behavior id: {behavior_id!r}")
                continue
            if behavior_id in behavior_ids:
                findings.append(f"duplicate behavior id: {behavior_id}")
            behavior_ids.add(behavior_id)
            if row.get("classification") not in {"intended", "control-defect", "incidental"}:
                findings.append(f"invalid classification: {behavior_id}")
            if not isinstance(row.get("owner"), str) or not row.get("owner"):
                findings.append(f"missing behavior owner: {behavior_id}")
            if row.get("status") != "FROZEN":
                findings.append(f"behavior is not FROZEN: {behavior_id}")
            refs = row.get("source_refs")
            if not isinstance(refs, list) or not refs:
                findings.append(f"behavior lacks source refs: {behavior_id}")
            else:
                for ref in refs:
                    if not isinstance(ref, dict):
                        findings.append(f"invalid source ref: {behavior_id}")
                        continue
                    source_id = ref.get("source_id")
                    exact = ref.get("exact")
                    if source_id not in sources or not isinstance(exact, str) or not exact:
                        findings.append(f"invalid source ref: {behavior_id}")
                    elif exact.encode() not in sources[source_id]:
                        findings.append(f"source excerpt is absent: {behavior_id}/{source_id}")
            ids = row.get("oracle_ids")
            if not isinstance(ids, list) or not ids or not all(isinstance(item, str) for item in ids):
                findings.append(f"behavior lacks oracle ids: {behavior_id}")
            else:
                oracle_refs.update(ids)

    milestones = ledger.get("milestones")
    if not isinstance(milestones, list) or not milestones:
        findings.append("intent-ledger milestones must be a non-empty list")
    else:
        required = ("id", "precondition", "setter", "allowed_next", "forbidden_next", "mutable_artifact")
        for row in milestones:
            if not isinstance(row, dict) or any(
                not isinstance(row.get(field), str) or not row.get(field) for field in required
            ):
                findings.append("milestone lacks one of its six structural fields")
    ledger_hash = digest(path.read_bytes()) if path.is_file() else digest(b"")
    return ledger, behavior_ids, oracle_refs, source_set_hash + ":" + ledger_hash


def validate_failure_trace(repo: Path, dossier: Path, findings: list[str]) -> None:
    trace = load_object(dossier / "failure-trace.json", findings)
    if trace.get("version") != 1:
        findings.append("failure-trace version is invalid")
    histories: dict[str, bytes] = {}
    raw = trace.get("histories")
    if not isinstance(raw, list) or len(raw) < 2:
        findings.append("failure-trace must hash both raw histories")
    else:
        for item in raw:
            if not isinstance(item, dict):
                findings.append("history entry must be an object")
                continue
            path = relative_path(item.get("path"))
            expected = item.get("sha256")
            if path is None or not isinstance(expected, str) or not HEX64.fullmatch(expected):
                findings.append("history metadata is invalid")
                continue
            target = repo / path
            if not target.is_file() or digest(target.read_bytes()) != expected:
                findings.append(f"history hash mismatch: {path}")
                continue
            histories[path.as_posix()] = target.read_bytes()
    for field in ("pre_state", "user_transition", "first_wrong_mutation"):
        ref = trace.get(field)
        if not isinstance(ref, dict):
            findings.append(f"failure-trace {field} is missing")
            continue
        source = ref.get("source")
        exact = ref.get("exact")
        if source not in histories or not isinstance(exact, str) or not exact:
            findings.append(f"failure-trace {field} reference is invalid")
        elif exact.encode() not in histories[source]:
            findings.append(f"failure-trace {field} excerpt is absent")


def run_oracle(command: object, dossier: Path) -> subprocess.CompletedProcess[str] | None:
    if not isinstance(command, list) or not all(isinstance(item, str) for item in command):
        return None
    if command[:4] != ["uv", "run", "--no-project", "python"]:
        return None
    for value in command[4:]:
        if Path(value).is_absolute() or ".." in Path(value).parts:
            return None
    try:
        return subprocess.run(
            command,
            cwd=dossier,
            capture_output=True,
            text=True,
            timeout=30,
            check=False,
        )
    except (OSError, subprocess.TimeoutExpired):
        return None


def validate_oracles(
    dossier: Path,
    behavior_ids: set[str],
    referenced_ids: set[str],
    findings: list[str],
) -> None:
    manifest = load_object(dossier / "oracle-manifest.json", findings)
    if manifest.get("version") != 1:
        findings.append("oracle-manifest version is invalid")
    rows = manifest.get("oracles")
    oracle_ids: set[str] = set()
    covered: set[str] = set()
    if not isinstance(rows, list) or not rows:
        findings.append("oracle-manifest oracles must be a non-empty list")
        return
    for row in rows:
        if not isinstance(row, dict):
            findings.append("oracle entry must be an object")
            continue
        oracle_id = row.get("id")
        if not isinstance(oracle_id, str) or not IDENT.fullmatch(oracle_id) or oracle_id in oracle_ids:
            findings.append(f"invalid or duplicate oracle id: {oracle_id!r}")
            continue
        oracle_ids.add(oracle_id)
        ids = row.get("behavior_ids")
        if not isinstance(ids, list) or not ids or any(item not in behavior_ids for item in ids):
            findings.append(f"oracle has invalid behavior refs: {oracle_id}")
        else:
            covered.update(ids)
        positive = run_oracle(row.get("positive"), dossier)
        if positive is None or positive.returncode != 0:
            findings.append(f"oracle positive did not pass: {oracle_id}")
        mutations = row.get("mutations")
        if not isinstance(mutations, list) or not mutations:
            findings.append(f"oracle has no calibrated mutation: {oracle_id}")
        else:
            for index, command in enumerate(mutations, 1):
                result = run_oracle(command, dossier)
                if result is None or result.returncode == 0:
                    findings.append(f"oracle mutation did not fail: {oracle_id}/{index}")
    if referenced_ids != oracle_ids:
        findings.append("behavior/oracle ID closure mismatch")
    if covered != behavior_ids:
        findings.append("not every behavior is covered by an executable oracle")


def validate_review_file(
    path: Path,
    provider: str,
    source_set_hash: str,
    ledger_hash: str,
    source_ids: set[str],
    behavior_ids: set[str],
    oracle_ids: set[str],
    findings: list[str],
) -> None:
    required = {
        "version",
        "provider",
        "source_sha256",
        "ledger_sha256",
        "verdict",
        "reviewed_source_ids",
        "reviewed_behavior_ids",
        "reviewed_oracle_ids",
        "missing_requirements",
        "misclassified_behavior_ids",
        "notes",
    }
    review = load_object(path, findings)
    if set(review) != required or review.get("version") != 1:
        findings.append(f"{provider} semantic review schema is invalid")
        return
    if review.get("provider") != provider:
        findings.append(f"{provider} semantic review provider mismatch")
    if review.get("source_sha256") != source_set_hash:
        findings.append(f"{provider} semantic review source hash mismatch")
    if review.get("ledger_sha256") != ledger_hash:
        findings.append(f"{provider} semantic review ledger hash mismatch")
    expected_sets = {
        "reviewed_source_ids": source_ids,
        "reviewed_behavior_ids": behavior_ids,
        "reviewed_oracle_ids": oracle_ids,
    }
    for field, expected in expected_sets.items():
        value = review.get(field)
        if (
            not isinstance(value, list)
            or not all(isinstance(item, str) for item in value)
            or set(value) != expected
            or len(value) != len(expected)
        ):
            findings.append(f"{provider} semantic review {field} is incomplete")
    missing = review.get("missing_requirements")
    misclassified = review.get("misclassified_behavior_ids")
    if not isinstance(missing, list) or not all(isinstance(item, str) for item in missing):
        findings.append(f"{provider} semantic review missing_requirements is invalid")
    if not isinstance(misclassified, list) or not all(
        isinstance(item, str) and item in behavior_ids for item in misclassified
    ):
        findings.append(f"{provider} semantic review misclassified IDs are invalid")
    verdict = review.get("verdict")
    if verdict not in {"PASS", "FAIL"}:
        findings.append(f"{provider} semantic review verdict is invalid")
    elif verdict != "PASS":
        findings.append(f"{provider} semantic review did not pass")
    elif missing or misclassified:
        findings.append(f"{provider} semantic review PASS contradicts reported gaps")
    if not isinstance(review.get("notes"), str) or not review.get("notes"):
        findings.append(f"{provider} semantic review notes are empty")


def validate_reviews(
    dossier: Path,
    ledger: dict[str, object],
    behavior_ids: set[str],
    oracle_ids: set[str],
    source_set_hash: str,
    ledger_hash: str,
    findings: list[str],
) -> None:
    raw_sources = ledger.get("sources")
    source_ids = {
        item["id"]
        for item in raw_sources if isinstance(item, dict) and isinstance(item.get("id"), str)
    } if isinstance(raw_sources, list) else set()
    for provider in ("claude", "codex"):
        validate_review_file(
            dossier / "semantic-reviews" / f"{provider}.json",
            provider,
            source_set_hash,
            ledger_hash,
            source_ids,
            behavior_ids,
            oracle_ids,
            findings,
        )


def validate(workspace: Path, output_path: Path, *, require_reviews: bool = True) -> list[str]:
    findings: list[str] = []
    repo = workspace / "repo"
    dossier = repo / "eval/decision-builder"
    ledger, behavior_ids, oracle_refs, combined_hash = validate_ledger(repo, dossier, findings)
    source_set_hash, ledger_hash = combined_hash.split(":", 1)
    validate_failure_trace(repo, dossier, findings)
    validate_oracles(dossier, behavior_ids, oracle_refs, findings)
    if require_reviews:
        validate_reviews(
            dossier,
            ledger,
            behavior_ids,
            oracle_refs,
            source_set_hash,
            ledger_hash,
            findings,
        )
    elif (dossier / "semantic-reviews").exists():
        findings.append("author created semantic reviews instead of leaving them external")
    if (dossier / "candidate").exists() or any(dossier.glob("candidate*")):
        findings.append("candidate was generated before intent acceptance")
    if (dossier / "control-results").exists():
        findings.append("control/candidate trials started during dossier phase")
    diff = subprocess.run(
        ["git", "diff", "--exit-code", "--", "decision-builder/SKILL.md"],
        cwd=repo,
        capture_output=True,
        check=False,
    )
    if diff.returncode != 0:
        findings.append("live target skill changed during dossier phase")
    outside_diff = subprocess.run(
        ["git", "diff", "--exit-code", "--", ".", ":!eval/decision-builder"],
        cwd=repo,
        capture_output=True,
        check=False,
    )
    if outside_diff.returncode != 0:
        findings.append("tracked input changed outside the dossier")
    untracked = subprocess.run(
        ["git", "ls-files", "--others", "--exclude-standard"],
        cwd=repo,
        capture_output=True,
        check=False,
        text=True,
    )
    if untracked.returncode != 0 or any(
        path and not path.startswith("eval/decision-builder/")
        for path in untracked.stdout.splitlines()
    ):
        findings.append("untracked output escaped the dossier")
    try:
        if not output_path.read_text(encoding="utf-8").strip():
            findings.append("agent produced no user-visible summary")
    except OSError as exc:
        findings.append(f"cannot read agent output: {exc}")
    return findings
