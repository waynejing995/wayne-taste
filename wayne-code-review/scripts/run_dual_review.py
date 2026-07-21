#!/usr/bin/env python3
"""Run independent Claude and Codex static reviews over one frozen patch."""

from __future__ import annotations

import argparse
import concurrent.futures
import hashlib
import json
import os
import re
import stat
import subprocess
import sys
import tempfile
import threading
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any


SCHEMA_VERSION = "wayne-code-review/dual-review/v1"
PROVIDERS = ("claude", "codex")
DEFAULT_TIMEOUT_SECONDS = 1800.0
TOP_FIELDS = {"verdict", "review_type", "patch_sha256", "findings"}
FINDING_FIELDS = {
    "severity",
    "confidence",
    "category",
    "file",
    "line",
    "problem",
    "evidence",
    "fix",
}
SEVERITIES = {"CRITICAL", "INFORMATIONAL"}
SAFE_REVIEW_TYPE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._/,+-]*$")
PLAYBOOK_HEADINGS = {
    "general": "General",
    "intent-scope": "Intent and scope",
    "security": "Security",
    "dataflow": "Dataflow and re-architecture",
    "dataflow-rearch": "Dataflow and re-architecture",
    "architecture": "Architecture and state",
    "architecture-state": "Architecture and state",
    "concurrency": "Concurrency and reliability",
    "concurrency-reliability": "Concurrency and reliability",
    "performance": "Performance and capacity",
    "performance-capacity": "Performance and capacity",
    "tests": "Tests",
    "api-migration": "API and migration",
}


@dataclass(frozen=True)
class ProviderSpec:
    name: str
    command: list[str]
    cwd: Path
    model_override: str | None
    native_path: Path
    stderr_path: Path
    last_message_path: Path | None
    env: dict[str, str]


@dataclass
class ProviderRun:
    name: str
    started_mono_ns: int
    ended_mono_ns: int
    exit_code: int
    timed_out: bool = False
    spawn_error: str | None = None


def sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def digest(path: Path) -> str:
    return sha256_bytes(path.read_bytes())


def load_intent_sources(repo: Path, values: list[str]) -> list[dict[str, str]]:
    sources: list[dict[str, str]] = []
    seen: set[str] = set()
    for raw in values:
        requested = Path(raw)
        if requested.is_absolute():
            raise RuntimeError(f"intent source must be repository-relative: {raw}")
        path = (repo / requested).resolve()
        if not path.is_relative_to(repo) or path == repo:
            raise RuntimeError(f"intent source escapes repository: {raw}")
        if not path.is_file():
            raise RuntimeError(f"intent source not found: {raw}")
        relative = path.relative_to(repo).as_posix()
        if relative in seen:
            raise RuntimeError(f"duplicate intent source: {relative}")
        seen.add(relative)
        raw_bytes = path.read_bytes()
        try:
            text = raw_bytes.decode("utf-8")
        except UnicodeDecodeError as exc:
            raise RuntimeError(f"intent source is not UTF-8 text: {relative}") from exc
        sources.append(
            {"path": relative, "sha256": sha256_bytes(raw_bytes), "text": text}
        )
    return sources


def load_intent_summary(path: Path | None) -> dict[str, str] | None:
    if path is None:
        return None
    resolved = path.expanduser().resolve()
    if not resolved.is_file():
        raise RuntimeError(f"intent summary not found: {resolved}")
    raw_bytes = resolved.read_bytes()
    try:
        text = raw_bytes.decode("utf-8")
    except UnicodeDecodeError as exc:
        raise RuntimeError(f"intent summary is not UTF-8 text: {resolved}") from exc
    return {"sha256": sha256_bytes(raw_bytes), "text": text}


def write_json(path: Path, data: object) -> None:
    path.write_text(json.dumps(data, indent=2, sort_keys=True) + "\n", encoding="utf-8")


def write_preflight_unavailable(
    output_dir: Path,
    review_type: str,
    claude_model: str | None,
    codex_model: str | None,
    reason: str,
    repo_hash: str,
) -> None:
    empty_sha = sha256_bytes(b"")
    providers: dict[str, dict[str, Any]] = {}
    now = time.monotonic_ns()
    for index, (provider, model) in enumerate(
        (("claude", claude_model), ("codex", codex_model)), start=1
    ):
        review_path = output_dir / f"{provider}-review.json"
        native_path = output_dir / f"{provider}-native.jsonl"
        write_json(review_path, {})
        native_path.write_text(
            json.dumps({"type": "adapter_error", "error": reason}) + "\n",
            encoding="utf-8",
        )
        providers[provider] = {
            "model_family": provider,
            "model": model or "provider-default",
            "session_id": "",
            "status": "INVALID",
            "exit_code": 125,
            "started_mono_ns": now + index,
            "ended_mono_ns": now + index + 1,
            "payload_sha256": empty_sha,
            "review_file": review_path.name,
            "review_sha256": digest(review_path),
            "native_trace_file": native_path.name,
            "native_trace_sha256": digest(native_path),
        }
    write_json(
        output_dir / "manifest.json",
        {
            "schema_version": SCHEMA_VERSION,
            "status": "REVIEW_UNAVAILABLE",
            "review_type": review_type,
            "base_sha": "",
            "head_sha": "",
            "patch_sha256": empty_sha,
            "payload_sha256": empty_sha,
            "repo_manifest_before_sha256": repo_hash,
            "repo_manifest_after_sha256": repo_hash,
            "providers": providers,
        },
    )


def git(repo: Path, *args: str) -> bytes:
    result = subprocess.run(
        ["git", "-C", str(repo), *args],
        check=False,
        capture_output=True,
    )
    if result.returncode != 0:
        detail = result.stderr.decode("utf-8", errors="replace").strip()
        raise RuntimeError(f"git {' '.join(args)} failed: {detail}")
    return result.stdout


def repo_manifest(root: Path) -> str:
    """Hash Git-native tracked state plus metadata for untracked paths."""

    hasher = hashlib.sha256()
    git_views = (
        ("index", ("ls-files", "--stage", "-z")),
        ("head", ("rev-parse", "--verify", "HEAD")),
        ("refs", ("show-ref", "--head", "-d")),
        ("status", ("status", "--porcelain=v2", "-z", "--untracked-files=all")),
        (
            "tracked-diff",
            (
                "diff",
                "--binary",
                "--full-index",
                "--no-ext-diff",
                "--no-color",
                "HEAD",
                "--",
            ),
        ),
    )
    for label, args in git_views:
        data = git(root, *args)
        hasher.update(label.encode() + b"\0" + data + b"\0")
    names = git(root, "ls-files", "-z", "--others", "--exclude-standard").split(
        b"\0"
    )
    relative_names = sorted(
        name.decode("utf-8", errors="surrogateescape") for name in names if name
    )
    for relative in relative_names:
        path = root / relative
        if not path.exists() and not path.is_symlink():
            hasher.update(f"{relative}\0missing\0".encode())
            continue
        info = path.stat(follow_symlinks=False)
        mode = stat.S_IMODE(info.st_mode)
        if stat.S_ISREG(info.st_mode):
            kind = "file"
        elif stat.S_ISDIR(info.st_mode):
            kind = "dir"
        elif stat.S_ISLNK(info.st_mode):
            kind = "symlink"
        else:
            kind = "special"
        hasher.update(
            f"{relative}\0{kind}\0{mode:o}\0{info.st_size}\0{info.st_mtime_ns}\0".encode()
        )
        if kind == "symlink":
            hasher.update(os.readlink(path).encode("utf-8", errors="surrogateescape"))
        hasher.update(b"\0")
    return hasher.hexdigest()


def locate_schema(override: str | None) -> Path:
    if override:
        path = Path(override).expanduser().resolve()
        if not path.is_file():
            raise RuntimeError(f"reviewer schema not found: {path}")
        return path
    candidate = Path(__file__).resolve().parent.parent / "references/reviewer-schema.json"
    if candidate.is_file():
        return candidate
    raise RuntimeError("reviewer-schema.json was not found; set WAYNE_REVIEWER_SCHEMA")


def load_playbooks(review_type: str) -> str:
    path = Path(__file__).resolve().parent.parent / "references/review-playbooks.md"
    text = path.read_text(encoding="utf-8")
    shared_match = re.search(
        r"^## Shared evidence contract\n(.*?)(?=^## )", text, re.MULTILINE | re.DOTALL
    )
    if not shared_match:
        raise RuntimeError("shared evidence contract missing from review playbooks")
    selected = ["## Shared evidence contract\n" + shared_match.group(1).strip()]
    seen: set[str] = set()
    routes = [route.strip() for route in re.split(r"[,+]", review_type) if route.strip()]
    for route in routes:
        heading = PLAYBOOK_HEADINGS.get(route)
        if heading is None:
            raise RuntimeError(f"review playbook is not defined: {route}")
        if heading in seen:
            continue
        match = re.search(
            rf"^## {re.escape(heading)}\n(.*?)(?=^## |\Z)",
            text,
            re.MULTILINE | re.DOTALL,
        )
        if not match:
            raise RuntimeError(f"review playbook section missing: {heading}")
        selected.append(f"## {heading}\n{match.group(1).strip()}")
        seen.add(heading)
    return "\n\n".join(selected)


def load_schema(path: Path) -> dict[str, Any]:
    data = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(data, dict) or set(data.get("required", [])) != TOP_FIELDS:
        raise RuntimeError("reviewer schema top-level contract differs")
    finding = data.get("properties", {}).get("findings", {}).get("items", {})
    if set(finding.get("required", [])) != FINDING_FIELDS:
        raise RuntimeError("reviewer schema finding contract differs")
    return data


def build_payload(
    review_type: str,
    base_sha: str,
    head_sha: str,
    patch_sha: str,
    patch: bytes,
    schema: dict[str, Any],
    playbooks: str,
    intent_sources: list[dict[str, str]],
    intent_summary: dict[str, str] | None,
) -> bytes:
    patch_text = patch.decode("utf-8", errors="replace")
    schema_text = json.dumps(schema, separators=(",", ":"), sort_keys=True)
    source_blocks = "\n\n".join(
        "INTENT SOURCE "
        f"{source['path']} SHA256 {source['sha256']} BEGIN\n"
        f"{source['text']}\n"
        f"INTENT SOURCE {source['path']} END"
        for source in intent_sources
    )
    if not source_blocks:
        source_blocks = "NO CALLER-SELECTED INTENT SOURCE"
    summary_block = (
        "NO CALLER-AUTHORED INTENT SUMMARY"
        if intent_summary is None
        else (
            f"CALLER INTENT SUMMARY SHA256 {intent_summary['sha256']} BEGIN\n"
            f"{intent_summary['text']}\n"
            "CALLER INTENT SUMMARY END"
        )
    )
    text = f"""You are one of two independent static code-review voices.

REVIEW_TYPE: {review_type}
BASE_SHA: {base_sha}
HEAD_SHA: {head_sha}
PATCH_SHA256: {patch_sha}
MUTATION_POLICY: read-only

Review only the supplied patch and repository evidence relevant to REVIEW_TYPE.
The caller-selected intent sources below are the complete normative intent set for
this review. Do not select another plan, spec, or issue as approved intent. The
caller summary is orientation only and cannot override the full source bytes. You
may inspect other repository files, producers, consumers, and callers as evidence,
but you must not edit files, stage, commit, fetch, run the application or tests,
write a checkpoint, or invoke another workflow. Do not assume the other reviewer's
opinion and do not emit compliments or a prose wrapper.

Return exactly one JSON object conforming to this schema:
{schema_text}

Set review_type exactly to {json.dumps(review_type)} and patch_sha256 exactly to
{json.dumps(patch_sha)}. Use verdict "NO FINDINGS" with an empty findings array
only when this review type has no evidence-backed issue. Every finding must cite
an exact repository-relative file and positive line, and evidence must name the
concrete code facts that support it.

SELECTED REVIEW PLAYBOOKS BEGIN
{playbooks}
SELECTED REVIEW PLAYBOOKS END

CALLER INTENT PACKET BEGIN
{summary_block}

{source_blocks}
CALLER INTENT PACKET END

FROZEN PATCH BEGIN
{patch_text}
FROZEN PATCH END
"""
    return text.encode("utf-8")


def iter_jsonl(path: Path) -> tuple[list[dict[str, Any]], list[str]]:
    events: list[dict[str, Any]] = []
    errors: list[str] = []
    try:
        lines = path.read_text(encoding="utf-8").splitlines()
    except OSError as exc:
        return [], [f"cannot read native trace: {exc}"]
    for index, line in enumerate(lines, start=1):
        if not line.strip():
            continue
        try:
            value = json.loads(line)
        except json.JSONDecodeError as exc:
            errors.append(f"native trace line {index} is not JSON: {exc}")
            continue
        if not isinstance(value, dict):
            errors.append(f"native trace line {index} is not an object")
            continue
        events.append(value)
    if not events:
        errors.append("native trace contains no JSON events")
    return events, errors


def nested_strings(value: Any, keys: set[str]) -> list[str]:
    found: list[str] = []
    if isinstance(value, dict):
        for key, child in value.items():
            if key in keys and isinstance(child, str) and child.strip():
                found.append(child.strip())
            found.extend(nested_strings(child, keys))
    elif isinstance(value, list):
        for child in value:
            found.extend(nested_strings(child, keys))
    return found


def extract_claude(events: list[dict[str, Any]]) -> tuple[str, str | None, str | None]:
    session = next(iter(nested_strings(events, {"session_id"})), "")
    models = nested_strings(events, {"model"})
    model = models[0] if models else None
    result: str | None = None
    for event in events:
        if event.get("type") == "result" and isinstance(event.get("result"), str):
            result = event["result"]
    return session, model, result


def extract_codex(
    events: list[dict[str, Any]], last_message_path: Path
) -> tuple[str, str | None, str | None]:
    sessions = nested_strings(events, {"thread_id", "session_id"})
    models = nested_strings(events, {"model"})
    result = None
    if last_message_path.is_file():
        result = last_message_path.read_text(encoding="utf-8").strip()
    return (sessions[0] if sessions else ""), (models[0] if models else None), result


def parse_review(text: str | None) -> dict[str, Any]:
    if text is None or not text.strip():
        raise ValueError("review output is missing")
    candidate = text.strip()
    fence = re.fullmatch(r"```(?:json)?\s*(.*?)\s*```", candidate, re.DOTALL)
    if fence:
        candidate = fence.group(1).strip()
    try:
        data = json.loads(candidate)
    except json.JSONDecodeError as exc:
        raise ValueError(f"review output is not one JSON object: {exc}") from exc
    if not isinstance(data, dict):
        raise ValueError("review output is not an object")
    return data


def validate_review(data: dict[str, Any], review_type: str, patch_sha: str) -> list[str]:
    errors: list[str] = []
    if set(data) != TOP_FIELDS:
        errors.append(f"review fields differ: {sorted(data)}")
    if data.get("review_type") != review_type:
        errors.append("review_type mismatch")
    if data.get("patch_sha256") != patch_sha:
        errors.append("patch_sha256 mismatch")
    verdict = data.get("verdict")
    rows = data.get("findings")
    if verdict not in {"FINDINGS", "NO FINDINGS"}:
        errors.append("verdict invalid")
    if not isinstance(rows, list):
        errors.append("findings is not a list")
        return errors
    if (verdict == "NO FINDINGS") != (len(rows) == 0):
        errors.append("verdict/findings mismatch")
    for index, row in enumerate(rows, start=1):
        label = f"finding {index}"
        if not isinstance(row, dict) or set(row) != FINDING_FIELDS:
            errors.append(f"{label} fields invalid")
            continue
        if row["severity"] not in SEVERITIES:
            errors.append(f"{label} severity invalid")
        confidence = row["confidence"]
        if (
            isinstance(confidence, bool)
            or not isinstance(confidence, int)
            or not 1 <= confidence <= 10
        ):
            errors.append(f"{label} confidence invalid")
        for key in ("category", "file", "problem", "fix"):
            if not isinstance(row[key], str) or not row[key].strip():
                errors.append(f"{label} {key} missing")
        line = row["line"]
        if isinstance(line, bool) or not isinstance(line, int) or line < 1:
            errors.append(f"{label} line invalid")
        evidence = row["evidence"]
        if not isinstance(evidence, list) or not evidence or not all(
            isinstance(item, str) and item.strip() for item in evidence
        ):
            errors.append(f"{label} evidence missing")
    return errors


def run_provider(
    spec: ProviderSpec,
    payload: bytes,
    barrier: threading.Barrier,
    timeout_seconds: float,
) -> ProviderRun:
    barrier.wait()
    started = time.monotonic_ns()
    exit_code = 125
    timed_out = False
    spawn_error: str | None = None
    try:
        with spec.native_path.open("wb") as native, spec.stderr_path.open("wb") as error:
            process = subprocess.Popen(
                spec.command,
                stdin=subprocess.PIPE,
                stdout=native,
                stderr=error,
                shell=False,
                cwd=spec.cwd,
                env=spec.env,
            )
            try:
                process.communicate(input=payload, timeout=timeout_seconds)
            except subprocess.TimeoutExpired:
                timed_out = True
                process.kill()
                process.communicate()
            exit_code = 124 if timed_out else process.returncode
    except OSError as exc:
        exit_code = 127
        spawn_error = f"{type(exc).__name__}: {exc}"
        spec.native_path.write_text(
            json.dumps({"type": "adapter_error", "error": spawn_error}) + "\n",
            encoding="utf-8",
        )
        spec.stderr_path.write_text(spawn_error + "\n", encoding="utf-8")
    ended = time.monotonic_ns()
    return ProviderRun(
        name=spec.name,
        started_mono_ns=started,
        ended_mono_ns=ended,
        exit_code=exit_code,
        timed_out=timed_out,
        spawn_error=spawn_error,
    )


def provider_record(
    spec: ProviderSpec,
    run: ProviderRun,
    payload_sha: str,
    review_type: str,
    patch_sha: str,
) -> tuple[dict[str, Any], list[str]]:
    errors: list[str] = []
    events, trace_errors = iter_jsonl(spec.native_path)
    errors.extend(trace_errors)
    if spec.name == "claude":
        session, observed_model, raw_review = extract_claude(events)
    else:
        assert spec.last_message_path is not None
        session, observed_model, raw_review = extract_codex(events, spec.last_message_path)
    if run.spawn_error:
        errors.append(run.spawn_error)
    if run.timed_out:
        errors.append("provider timed out")
    if run.exit_code != 0:
        errors.append(f"provider exit code {run.exit_code}")
    if not session:
        errors.append("provider session id missing")

    review_path = spec.native_path.with_name(f"{spec.name}-review.json")
    review: dict[str, Any] = {}
    try:
        review = parse_review(raw_review)
    except ValueError as exc:
        errors.append(str(exc))
    else:
        errors.extend(validate_review(review, review_type, patch_sha))
    write_json(review_path, review)

    model = observed_model or spec.model_override or "provider-default"
    status = "OK" if not errors else "INVALID"
    record = {
        "model_family": spec.name,
        "model": model,
        "session_id": session,
        "status": status,
        "exit_code": run.exit_code,
        "started_mono_ns": run.started_mono_ns,
        "ended_mono_ns": run.ended_mono_ns,
        "payload_sha256": payload_sha,
        "review_file": review_path.name,
        "review_sha256": digest(review_path),
        "native_trace_file": spec.native_path.name,
        "native_trace_sha256": digest(spec.native_path),
    }
    return record, errors


def env_first(*names: str) -> str | None:
    for name in names:
        value = os.environ.get(name)
        if value:
            return value
    return None


def command_specs(
    args: argparse.Namespace,
    schema_path: Path,
    schema: dict[str, Any],
    output_dir: Path,
    repo: Path,
) -> dict[str, ProviderSpec]:
    claude_model = args.claude_model
    claude_env = os.environ.copy()
    claude_env.pop("CLAUDECODE", None)
    claude_env.pop("CLAUDE_CODE_ENTRYPOINT", None)
    claude_command = [
        args.claude_bin,
        "-p",
        "--safe-mode",
        "--permission-mode",
        "plan",
        "--tools",
        "Read,Grep,Glob",
        "--allowedTools",
        "Read,Grep,Glob",
        "--no-session-persistence",
        "--verbose",
        "--output-format",
        "stream-json",
        "--json-schema",
        json.dumps(schema, separators=(",", ":"), sort_keys=True),
    ]
    if claude_model:
        claude_command.extend(["--model", claude_model])
    if args.claude_effort:
        claude_command.extend(["--effort", args.claude_effort])

    codex_model = args.codex_model
    codex_env = os.environ.copy()
    codex_last = output_dir / "codex-last.txt"
    codex_command = [
        args.codex_bin,
        "exec",
        "--ephemeral",
        "--json",
        "--output-schema",
        str(schema_path),
        "-C",
        str(repo),
        "-o",
        str(codex_last),
    ]
    if codex_model:
        codex_command.extend(["--model", codex_model])
    if args.codex_effort:
        codex_command.extend(
            ["-c", f"model_reasoning_effort={json.dumps(args.codex_effort)}"]
        )
    codex_command.append("-")

    return {
        "claude": ProviderSpec(
            name="claude",
            command=claude_command,
            cwd=repo,
            model_override=claude_model,
            native_path=output_dir / "claude-native.jsonl",
            stderr_path=output_dir / "claude-stderr.txt",
            last_message_path=None,
            env=claude_env,
        ),
        "codex": ProviderSpec(
            name="codex",
            command=codex_command,
            cwd=repo,
            model_override=codex_model,
            native_path=output_dir / "codex-native.jsonl",
            stderr_path=output_dir / "codex-stderr.txt",
            last_message_path=codex_last,
            env=codex_env,
        ),
    }


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--review-type", required=True)
    parser.add_argument("--base", required=True)
    parser.add_argument(
        "--output-dir",
        type=Path,
        default=(
            Path(os.environ["WAYNE_REVIEW_OUTPUT_DIR"])
            if os.environ.get("WAYNE_REVIEW_OUTPUT_DIR")
            else Path(tempfile.mkdtemp(prefix="wayne-code-review-"))
        ),
        help="evidence directory outside the product repo (or WAYNE_REVIEW_OUTPUT_DIR)",
    )
    parser.add_argument("--repo", type=Path, default=Path.cwd())
    parser.add_argument(
        "--intent-source",
        action="append",
        default=[],
        metavar="REPO_RELATIVE_PATH",
        help="caller-selected normative intent source; repeat for multiple files",
    )
    parser.add_argument(
        "--intent-summary-file",
        type=Path,
        help="caller-authored orientation summary; full intent sources remain normative",
    )
    parser.add_argument(
        "--claude-bin", default=env_first("WAYNE_CLAUDE_BIN", "CLAUDE_BIN") or "claude"
    )
    parser.add_argument(
        "--codex-bin", default=env_first("WAYNE_CODEX_BIN", "CODEX_BIN") or "codex"
    )
    parser.add_argument(
        "--claude-model",
        default=env_first("WAYNE_CLAUDE_MODEL", "CLAUDE_REVIEW_MODEL", "CLAUDE_MODEL"),
    )
    parser.add_argument(
        "--codex-model",
        default=env_first("WAYNE_CODEX_MODEL", "CODEX_REVIEW_MODEL", "CODEX_MODEL"),
    )
    parser.add_argument(
        "--claude-effort", default=env_first("WAYNE_CLAUDE_EFFORT", "CLAUDE_EFFORT")
    )
    parser.add_argument(
        "--codex-effort", default=env_first("WAYNE_CODEX_EFFORT", "CODEX_EFFORT")
    )
    parser.add_argument(
        "--schema",
        default=env_first("WAYNE_REVIEWER_SCHEMA"),
        help="reviewer schema override (or WAYNE_REVIEWER_SCHEMA)",
    )
    parser.add_argument(
        "--timeout-seconds",
        type=float,
        default=float(
            os.environ.get("WAYNE_DUAL_REVIEW_TIMEOUT", str(DEFAULT_TIMEOUT_SECONDS))
        ),
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    if not SAFE_REVIEW_TYPE.fullmatch(args.review_type):
        print("REVIEW_UNAVAILABLE: invalid review type", file=sys.stderr)
        return 2
    if args.timeout_seconds <= 0:
        print("REVIEW_UNAVAILABLE: timeout must be positive", file=sys.stderr)
        return 2

    repo = args.repo.expanduser().resolve()
    output_dir = args.output_dir.expanduser().resolve()
    if not repo.is_dir():
        print(f"REVIEW_UNAVAILABLE: repository not found: {repo}", file=sys.stderr)
        return 2
    if output_dir == repo or output_dir.is_relative_to(repo):
        print(
            "REVIEW_UNAVAILABLE: output directory must be outside the product repository",
            file=sys.stderr,
        )
        return 2
    if output_dir.exists() and any(output_dir.iterdir()):
        print(f"REVIEW_UNAVAILABLE: output directory is not empty: {output_dir}", file=sys.stderr)
        return 2
    output_dir.mkdir(parents=True, exist_ok=True)

    try:
        before = repo_manifest(repo)
    except (OSError, RuntimeError) as exc:
        write_preflight_unavailable(
            output_dir,
            args.review_type,
            args.claude_model,
            args.codex_model,
            str(exc),
            "",
        )
        print(f"REVIEW_UNAVAILABLE: {exc}", file=sys.stderr)
        return 2

    try:
        schema_path = locate_schema(args.schema)
        schema = load_schema(schema_path)
        playbooks = load_playbooks(args.review_type)
        base_sha = git(repo, "rev-parse", "--verify", f"{args.base}^{{commit}}").decode().strip()
        head_sha = git(repo, "rev-parse", "--verify", "HEAD^{commit}").decode().strip()
        intent_sources = load_intent_sources(repo, args.intent_source)
        intent_summary = load_intent_summary(args.intent_summary_file)
        patch = git(
            repo,
            "diff",
            "--binary",
            "--full-index",
            "--no-ext-diff",
            "--no-color",
            base_sha,
            "--",
        )
        patch_sha = sha256_bytes(patch)
        payload = build_payload(
            args.review_type,
            base_sha,
            head_sha,
            patch_sha,
            patch,
            schema,
            playbooks,
            intent_sources,
            intent_summary,
        )
        payload_sha = sha256_bytes(payload)
        (output_dir / "payload.txt").write_bytes(payload)
        write_json(
            output_dir / "intent-inputs.json",
            {
                "sources": [
                    {"path": source["path"], "sha256": source["sha256"]}
                    for source in intent_sources
                ],
                "summary_sha256": intent_summary["sha256"] if intent_summary else None,
            },
        )
        specs = command_specs(args, schema_path, schema, output_dir, repo)
    except (OSError, RuntimeError, json.JSONDecodeError) as exc:
        write_preflight_unavailable(
            output_dir,
            args.review_type,
            args.claude_model,
            args.codex_model,
            str(exc),
            before,
        )
        print(f"REVIEW_UNAVAILABLE: {exc}", file=sys.stderr)
        return 2

    barrier = threading.Barrier(2)
    runs: dict[str, ProviderRun] = {}
    with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
        futures = {
            provider: pool.submit(
                run_provider, specs[provider], payload, barrier, args.timeout_seconds
            )
            for provider in PROVIDERS
        }
        for provider, future in futures.items():
            runs[provider] = future.result()

    providers: dict[str, dict[str, Any]] = {}
    failures: list[str] = []
    for provider in PROVIDERS:
        record, errors = provider_record(
            specs[provider], runs[provider], payload_sha, args.review_type, patch_sha
        )
        providers[provider] = record
        failures.extend(f"{provider}: {error}" for error in errors)

    sessions = {str(record["session_id"]) for record in providers.values() if record["session_id"]}
    if len(sessions) != 2:
        failures.append("review voices do not have distinct sessions")
    starts = [int(record["started_mono_ns"]) for record in providers.values()]
    ends = [int(record["ended_mono_ns"]) for record in providers.values()]
    if max(starts) >= min(ends):
        failures.append("Claude and Codex review intervals do not overlap")

    try:
        after = repo_manifest(repo)
    except (OSError, RuntimeError) as exc:
        after = ""
        failures.append(f"cannot capture repository manifest after review: {exc}")
    else:
        if after != before:
            failures.append("product repository manifest changed during review")
    status = "OK" if not failures else "REVIEW_UNAVAILABLE"
    manifest = {
        "schema_version": SCHEMA_VERSION,
        "status": status,
        "review_type": args.review_type,
        "base_sha": base_sha,
        "head_sha": head_sha,
        "patch_sha256": patch_sha,
        "payload_sha256": payload_sha,
        "repo_manifest_before_sha256": before,
        "repo_manifest_after_sha256": after,
        "providers": providers,
    }
    write_json(output_dir / "manifest.json", manifest)

    if failures:
        for failure in failures:
            print(f"REVIEW_UNAVAILABLE: {failure}", file=sys.stderr)
        return 1
    print(f"OK: dual review evidence written to {output_dir}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
