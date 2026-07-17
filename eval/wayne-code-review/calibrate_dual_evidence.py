#!/usr/bin/env python3
"""Calibrate the dual-review evidence validator."""

from __future__ import annotations

import copy
import hashlib
import json
import shutil
import tempfile
from pathlib import Path

from check_dual_evidence import validate_evidence


PATCH_SHA = "a" * 64
PAYLOAD_SHA = "b" * 64


def digest(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def write_json(path: Path, data: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, indent=2, sort_keys=True) + "\n", encoding="utf-8")


def review(
    patch_sha: str = PATCH_SHA,
    review_type: str = "security",
    rows: list[dict[str, object]] | None = None,
) -> dict[str, object]:
    default_rows: list[dict[str, object]] = [
        {
            "severity": "CRITICAL",
            "confidence": 10,
            "category": "shell-injection",
            "file": "src/export.py",
            "line": 8,
            "problem": "Untrusted paths are interpolated into a shell command.",
            "evidence": ["shell=True", "f-string includes report_path and destination_path"],
            "fix": "Use shutil.copy2 or an argv-only subprocess call.",
        }
    ]
    selected = default_rows if rows is None else rows
    return {
        "verdict": "FINDINGS" if selected else "NO FINDINGS",
        "review_type": review_type,
        "patch_sha256": patch_sha,
        "findings": selected,
    }


def valid_bundle(
    root: Path,
    patch_sha: str = PATCH_SHA,
    review_type: str = "security",
    rows: list[dict[str, object]] | None = None,
) -> dict[str, object]:
    providers: dict[str, object] = {}
    for index, provider in enumerate(("claude", "codex"), start=1):
        review_path = root / f"{provider}-review.json"
        trace_path = root / f"{provider}-native.jsonl"
        write_json(review_path, review(patch_sha, review_type, rows))
        trace_path.write_text(f'{{"session_id":"{provider}-session"}}\n', encoding="utf-8")
        providers[provider] = {
            "model_family": provider,
            "model": f"{provider}-test-model",
            "session_id": f"{provider}-session",
            "status": "OK",
            "exit_code": 0,
            "started_mono_ns": 100 + index,
            "ended_mono_ns": 300 + index,
            "payload_sha256": PAYLOAD_SHA,
            "review_file": review_path.name,
            "review_sha256": digest(review_path),
            "native_trace_file": trace_path.name,
            "native_trace_sha256": digest(trace_path),
        }
    manifest = {
        "schema_version": "wayne-code-review/dual-review/v1",
        "status": "OK",
        "review_type": review_type,
        "base_sha": "base",
        "head_sha": "head",
        "patch_sha256": patch_sha,
        "payload_sha256": PAYLOAD_SHA,
        "repo_manifest_before_sha256": "c" * 64,
        "repo_manifest_after_sha256": "c" * 64,
        "providers": providers,
    }
    write_json(root / "manifest.json", manifest)
    return manifest


def assert_finding(root: Path, needle: str, label: str) -> None:
    findings = validate_evidence(root, "security", PATCH_SHA)
    if not any(needle in finding for finding in findings):
        raise AssertionError(f"{label} missing {needle!r}: {findings}")


def mutate(root: Path, source: Path, name: str) -> tuple[Path, dict[str, object]]:
    target = root / name
    shutil.copytree(source, target)
    manifest = json.loads((target / "manifest.json").read_text(encoding="utf-8"))
    return target, manifest


def main() -> int:
    with tempfile.TemporaryDirectory(prefix="wayne-dual-evidence-") as temp:
        root = Path(temp)
        valid = root / "valid"
        valid.mkdir()
        valid_bundle(valid)
        findings = validate_evidence(valid, "security", PATCH_SHA)
        if findings:
            raise AssertionError(f"valid bundle failed: {findings}")

        cases: list[tuple[str, str]] = []
        target, data = mutate(root, valid, "missing-codex")
        del data["providers"]["codex"]
        write_json(target / "manifest.json", data)
        cases.append(("missing-codex", "exactly Claude and Codex"))

        target, data = mutate(root, valid, "same-family")
        data["providers"]["codex"]["model_family"] = "claude"
        write_json(target / "manifest.json", data)
        cases.append(("same-family", "model family mismatch"))

        target, data = mutate(root, valid, "same-session")
        data["providers"]["codex"]["session_id"] = "claude-session"
        write_json(target / "manifest.json", data)
        cases.append(("same-session", "reuse one session"))

        target, data = mutate(root, valid, "payload-drift")
        data["providers"]["codex"]["payload_sha256"] = "d" * 64
        write_json(target / "manifest.json", data)
        cases.append(("payload-drift", "payload hash differs"))

        target, data = mutate(root, valid, "serial")
        data["providers"]["codex"]["started_mono_ns"] = 400
        data["providers"]["codex"]["ended_mono_ns"] = 500
        write_json(target / "manifest.json", data)
        cases.append(("serial", "intervals do not overlap"))

        target, data = mutate(root, valid, "provider-failure")
        data["status"] = "REVIEW_UNAVAILABLE"
        data["providers"]["codex"]["status"] = "INVALID"
        data["providers"]["codex"]["exit_code"] = 42
        write_json(target / "manifest.json", data)
        cases.append(("provider-failure", "status is not OK"))

        target, data = mutate(root, valid, "repo-drift")
        data["repo_manifest_after_sha256"] = "e" * 64
        write_json(target / "manifest.json", data)
        cases.append(("repo-drift", "repository manifest changed"))

        target, data = mutate(root, valid, "review-hash")
        data["providers"]["claude"]["review_sha256"] = "f" * 64
        write_json(target / "manifest.json", data)
        cases.append(("review-hash", "missing or hash mismatch"))

        target, data = mutate(root, valid, "schema-field")
        review_path = target / "claude-review.json"
        review_data = json.loads(review_path.read_text(encoding="utf-8"))
        del review_data["findings"][0]["evidence"]
        write_json(review_path, review_data)
        data["providers"]["claude"]["review_sha256"] = digest(review_path)
        write_json(target / "manifest.json", data)
        cases.append(("schema-field", "fields invalid"))

        finding_mutations: dict[str, tuple[str, object, str]] = {
            "severity-value": ("severity", "LOW", "severity invalid"),
            "confidence-type": ("confidence", True, "confidence invalid"),
            "category-empty": ("category", "", "category missing"),
            "file-empty": ("file", "", "file missing"),
            "line-value": ("line", 0, "line invalid"),
            "problem-empty": ("problem", "", "problem missing"),
            "evidence-empty": ("evidence", [], "evidence missing"),
            "fix-empty": ("fix", "", "fix missing"),
        }
        for name, (field, value, needle) in finding_mutations.items():
            target, data = mutate(root, valid, name)
            review_path = target / "claude-review.json"
            review_data = json.loads(review_path.read_text(encoding="utf-8"))
            review_data["findings"][0][field] = value
            write_json(review_path, review_data)
            data["providers"]["claude"]["review_sha256"] = digest(review_path)
            write_json(target / "manifest.json", data)
            cases.append((name, needle))

        top_mutations: dict[str, tuple[str, object, str]] = {
            "verdict-mismatch": ("verdict", "NO FINDINGS", "verdict/findings mismatch"),
            "review-type": ("review_type", "general", "review type mismatch"),
            "patch-hash": ("patch_sha256", "d" * 64, "review patch hash mismatch"),
            "findings-type": ("findings", {}, "findings is not a list"),
        }
        for name, (field, value, needle) in top_mutations.items():
            target, data = mutate(root, valid, name)
            review_path = target / "claude-review.json"
            review_data = json.loads(review_path.read_text(encoding="utf-8"))
            review_data[field] = value
            write_json(review_path, review_data)
            data["providers"]["claude"]["review_sha256"] = digest(review_path)
            write_json(target / "manifest.json", data)
            cases.append((name, needle))

        target, data = mutate(root, valid, "extra-finding-field")
        review_path = target / "claude-review.json"
        review_data = json.loads(review_path.read_text(encoding="utf-8"))
        review_data["findings"][0]["extra"] = "not allowed"
        write_json(review_path, review_data)
        data["providers"]["claude"]["review_sha256"] = digest(review_path)
        write_json(target / "manifest.json", data)
        cases.append(("extra-finding-field", "fields invalid"))

        for name, needle in cases:
            assert_finding(root / name, needle, name)

    print(f"PASS: 1 positive and {len(cases)} independent mutations")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
