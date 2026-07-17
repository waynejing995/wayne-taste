#!/usr/bin/env python3
"""Validate deterministic Claude+Codex review evidence."""

from __future__ import annotations

import argparse
import hashlib
import json
import re
from pathlib import Path
from typing import Any


SHA256 = re.compile(r"^[0-9a-f]{64}$")
PROVIDERS = {"claude", "codex"}
SEVERITIES = {"CRITICAL", "INFORMATIONAL"}


def digest(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def load_json(path: Path, findings: list[str], label: str) -> dict[str, Any] | None:
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        findings.append(f"invalid {label} JSON: {exc}")
        return None
    if not isinstance(data, dict):
        findings.append(f"{label} is not an object")
        return None
    return data


def validate_review(
    path: Path,
    provider: str,
    review_type: str,
    patch_sha: str,
    findings: list[str],
) -> None:
    data = load_json(path, findings, f"{provider} review")
    if data is None:
        return
    allowed = {"verdict", "review_type", "patch_sha256", "findings"}
    if set(data) != allowed:
        findings.append(f"{provider} review fields differ: {sorted(data)}")
    if data.get("review_type") != review_type:
        findings.append(f"{provider} review type mismatch")
    if data.get("patch_sha256") != patch_sha:
        findings.append(f"{provider} review patch hash mismatch")
    rows = data.get("findings")
    if not isinstance(rows, list):
        findings.append(f"{provider} findings is not a list")
        return
    verdict = data.get("verdict")
    if verdict not in {"FINDINGS", "NO FINDINGS"}:
        findings.append(f"{provider} verdict invalid")
    if (verdict == "NO FINDINGS") != (len(rows) == 0):
        findings.append(f"{provider} verdict/findings mismatch")
    required = {
        "severity", "confidence", "category", "file", "line", "problem", "evidence", "fix"
    }
    for index, row in enumerate(rows, start=1):
        label = f"{provider} finding {index}"
        if not isinstance(row, dict) or set(row) != required:
            findings.append(f"{label} fields invalid")
            continue
        if row["severity"] not in SEVERITIES:
            findings.append(f"{label} severity invalid")
        if (
            isinstance(row["confidence"], bool)
            or not isinstance(row["confidence"], int)
            or not 1 <= row["confidence"] <= 10
        ):
            findings.append(f"{label} confidence invalid")
        for key in ("category", "file", "problem", "fix"):
            if not isinstance(row[key], str) or not row[key].strip():
                findings.append(f"{label} {key} missing")
        if isinstance(row["line"], bool) or not isinstance(row["line"], int) or row["line"] < 1:
            findings.append(f"{label} line invalid")
        if not isinstance(row["evidence"], list) or not row["evidence"] or not all(
            isinstance(item, str) and item.strip() for item in row["evidence"]
        ):
            findings.append(f"{label} evidence missing")


def validate_evidence(
    evidence_dir: Path,
    expected_type: str,
    expected_patch: str | None = None,
) -> list[str]:
    findings: list[str] = []
    manifest = load_json(evidence_dir / "manifest.json", findings, "evidence manifest")
    if manifest is None:
        return findings
    required = {
        "schema_version", "status", "review_type", "base_sha", "head_sha",
        "patch_sha256", "payload_sha256", "repo_manifest_before_sha256",
        "repo_manifest_after_sha256", "providers"
    }
    if set(manifest) != required:
        findings.append(f"evidence manifest fields differ: {sorted(manifest)}")
    if manifest.get("schema_version") != "wayne-code-review/dual-review/v1":
        findings.append("evidence schema version mismatch")
    if manifest.get("status") != "OK":
        findings.append(f"dual review status is not OK: {manifest.get('status')!r}")
    if manifest.get("review_type") != expected_type:
        findings.append("evidence review type mismatch")
    patch_sha = str(manifest.get("patch_sha256", ""))
    if not SHA256.fullmatch(patch_sha):
        findings.append("evidence patch hash invalid")
    if expected_patch is not None and patch_sha != expected_patch:
        findings.append("evidence patch hash differs from frozen fixture")
    payload_sha = str(manifest.get("payload_sha256", ""))
    if not SHA256.fullmatch(payload_sha):
        findings.append("evidence payload hash invalid")
    if manifest.get("repo_manifest_before_sha256") != manifest.get(
        "repo_manifest_after_sha256"
    ):
        findings.append("repository manifest changed during review")

    providers = manifest.get("providers")
    if not isinstance(providers, dict) or set(providers) != PROVIDERS:
        findings.append("evidence does not contain exactly Claude and Codex")
        return findings
    sessions: set[str] = set()
    starts: list[int] = []
    ends: list[int] = []
    for provider in sorted(PROVIDERS):
        record = providers.get(provider)
        label = f"{provider} provider"
        if not isinstance(record, dict):
            findings.append(f"{label} record invalid")
            continue
        required_provider = {
            "model_family", "model", "session_id", "status", "exit_code",
            "started_mono_ns", "ended_mono_ns", "payload_sha256", "review_file",
            "review_sha256", "native_trace_file", "native_trace_sha256"
        }
        if set(record) != required_provider:
            findings.append(f"{label} fields differ: {sorted(record)}")
        if record.get("model_family") != provider:
            findings.append(f"{label} model family mismatch")
        if record.get("status") != "OK" or record.get("exit_code") != 0:
            findings.append(f"{label} did not complete successfully")
        if record.get("payload_sha256") != payload_sha:
            findings.append(f"{label} payload hash differs")
        session = record.get("session_id")
        if not isinstance(session, str) or not session:
            findings.append(f"{label} session id missing")
        elif session in sessions:
            findings.append("review voices reuse one session id")
        else:
            sessions.add(session)
        started = record.get("started_mono_ns")
        ended = record.get("ended_mono_ns")
        if not isinstance(started, int) or not isinstance(ended, int) or ended <= started:
            findings.append(f"{label} timing invalid")
        else:
            starts.append(started)
            ends.append(ended)
        for file_key, hash_key in (
            ("review_file", "review_sha256"),
            ("native_trace_file", "native_trace_sha256"),
        ):
            relative = record.get(file_key)
            expected_hash = record.get(hash_key)
            path = evidence_dir / str(relative)
            if not path.is_file() or digest(path) != expected_hash:
                findings.append(f"{label} {file_key} missing or hash mismatch")
        review_path = evidence_dir / str(record.get("review_file", ""))
        if review_path.is_file():
            validate_review(review_path, provider, expected_type, patch_sha, findings)
    if len(starts) == 2 and len(ends) == 2 and max(starts) >= min(ends):
        findings.append("Claude and Codex review intervals do not overlap")
    return findings


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("evidence_dir", type=Path)
    parser.add_argument("--review-type", required=True)
    parser.add_argument("--patch-sha")
    args = parser.parse_args()
    findings = validate_evidence(args.evidence_dir.resolve(), args.review_type, args.patch_sha)
    if findings:
        for finding in findings:
            print(f"FAIL: {finding}")
        return 1
    print("PASS: dual-review evidence")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
