#!/usr/bin/env python3
"""Calibrate the frozen Wayne Mind Explode checker with valid and mutated trials."""

from __future__ import annotations

import json
import shutil
import subprocess
import tempfile
from pathlib import Path

from check_decision_trace import validate_trace
from check_trial import E2E_HEADER, validate


HARNESS = Path(__file__).resolve().parent


def seed(workspace: Path, case: str) -> Path:
    repo = workspace / "repo"
    shutil.copytree(HARNESS / "fixture", repo)
    shutil.copy(HARNESS / "cases" / case / "case.md", repo / "case.md")
    return repo


def write(path: Path, text: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding="utf-8")


def run_review(repo: Path, role: str, spec: Path) -> str:
    process = subprocess.run(
        ["uv", "run", "--no-project", "python", str(HARNESS / "support" / "review.py"), role, str(spec)],
        cwd=repo,
        check=True,
        capture_output=True,
        text=True,
    )
    return process.stdout


def valid_complete(workspace: Path, case: str = "complete") -> Path:
    repo = seed(workspace, case)
    decision_rel = "docs/decisions/2026-07-16-delivery-retry-decisions.md"
    spec_rel = "docs/specs/2026-07-16-delivery-retry-design.md"
    matrix_rel = "docs/test-matrix/2026-07-16-delivery-retry-test-matrix.md"
    decision = repo / decision_rel
    spec = repo / spec_rel
    matrix = repo / matrix_rel

    write(
        decision,
        f"""# Decision Log: Delivery Retry

Status: design-approved

| # | Question | Decision | Rationale | Source |
|---|---|---|---|---|
| 1 | Owner | Dispatcher | One lifecycle owner | codebase |
| 2 | Product review | PASS | Assumptions resolved | review |
| 3 | Engineering review | PASS | Readiness resolved | review |

Spec: {spec_rel}
Test matrix: {matrix_rel}
""",
    )
    write(
        matrix,
        f"""# Delivery Retry Test Matrix

## Unit / Integration Matrix

| ID | Behavior | Expected |
|---|---|---|
| U1 | transient failure | bounded retry |

## E2E Verification Contract

{E2E_HEADER}
|---|---|---|---|---|---|
| E1 | CLI: dispatch | transient endpoint | submit delivery | terminal result is visible | ⬜ |
""",
    )
    write(
        spec,
        f"""# Delivery Retry Design

## Problem

Bound transient retries without adding another state owner.

## Alternatives

The selected approach keeps retry transitions in Dispatcher; two rejected options
split ownership or add unapproved storage.

## Architecture

Plant: delivery execution. Controller: Dispatcher. Setpoint: terminal delivery.
Disturbance: transient transport failure. Feedback: attempt outcome.

## Cybernetics

One lifecycle owner preserves observability and controllability.

## Failure Handling

Unsupported failures terminate loudly.

## Rollback

Remove the retry command path while retaining existing states.

## Test Matrix

The matrix SSoT is [delivery retry test matrix](../test-matrix/2026-07-16-delivery-retry-test-matrix.md).
""",
    )

    run_review(repo, "product", spec)
    run_review(repo, "engineering", spec)
    with spec.open("a", encoding="utf-8") as handle:
        handle.write(
            "\n## Assumption Challenge\n\nScope and user value are explicit."
            "\n\n## Operational Readiness\n\nOwnership, concurrency, observability, and rollback are explicit.\n"
        )
    write(repo / "docs/reviews/product.md", run_review(repo, "product", spec))
    write(repo / "docs/reviews/engineering.md", run_review(repo, "engineering", spec))
    write(
        repo / ".wayne/checkpoints/handoff.md",
        f"""status: design-approved
next_agent: wayne-plan
decision_log: {decision_rel}
spec: {spec_rel}
test_matrix: {matrix_rel}
next_prompt: Read the decision log, spec, and test matrix and create the implementation plan.
""",
    )
    output = workspace / "output.txt"
    write(
        output,
        f"设计已完成：`{decision_rel}`、`{spec_rel}`、`{matrix_rel}`。下一步调用 wayne-plan。",
    )
    return output


def valid_conflict(workspace: Path) -> Path:
    repo = seed(workspace, "conflict")
    write(
        repo / "docs/decisions/2026-07-16-durable-pause-decisions.md",
        "# Decision Log: Durable Pause\n\nStatus: in-progress\n\nR1 and R2 conflict; awaiting user.\n",
    )
    output = workspace / "output.txt"
    write(
        output,
        "检测到 R1 与 R2 冲突。My recommendation: 保留 R2，并把持久化暂停移出本次范围。你同意吗？",
    )
    return output


def assert_valid(workspace: Path, case: str, output: Path, label: str) -> None:
    findings = validate(workspace, case, output)
    if findings:
        raise AssertionError(f"{label} should pass: {findings}")


def assert_invalid(workspace: Path, case: str, output: Path, needle: str, label: str) -> None:
    findings = validate(workspace, case, output)
    if not any(needle in finding for finding in findings):
        raise AssertionError(f"{label} missing {needle!r}: {json.dumps(findings, ensure_ascii=False)}")


def clone(source: Path, root: Path, name: str) -> Path:
    target = root / name
    shutil.copytree(source, target)
    return target


def main() -> int:
    with tempfile.TemporaryDirectory(prefix="mind-explode-calibration-") as temp:
        root = Path(temp)
        valid = root / "valid"
        valid.mkdir()
        output = valid_complete(valid)
        assert_valid(valid, "complete", output, "positive complete")

        for provider, name in (("codex", "codex-valid.log"), ("claude", "claude-valid.jsonl")):
            findings = validate_trace(HARNESS / "trace-fixtures" / name, provider)
            if findings:
                raise AssertionError(f"positive {provider} trace should pass: {findings}")

        for provider, name in (("codex", "codex-batch.log"), ("claude", "claude-batch.jsonl")):
            findings = validate_trace(HARNESS / "trace-fixtures" / name, provider)
            if not any("appended 2 decisions" in finding for finding in findings):
                raise AssertionError(f"batched {provider} trace was not rejected: {findings}")

        missing_voice = clone(valid, root, "missing-voice")
        (missing_voice / "repo/docs/reviews/engineering.md").unlink()
        assert_invalid(
            missing_voice,
            "complete",
            missing_voice / "output.txt",
            "missing final engineering review report",
            "missing voice",
        )

        stale = clone(valid, root, "stale-review")
        with (stale / "repo/docs/specs/2026-07-16-delivery-retry-design.md").open("a", encoding="utf-8") as handle:
            handle.write("\nUnreviewed change.\n")
        assert_invalid(stale, "complete", stale / "output.txt", "did not pass the final spec revision", "stale review")

        plan = clone(valid, root, "plan-written")
        write(plan / "repo/docs/plans/implementation.md", "# Forbidden plan\n")
        assert_invalid(plan, "complete", plan / "output.txt", "implementation plan written", "plan boundary")

        duplicate = clone(valid, root, "duplicate-e2e")
        with (duplicate / "repo/docs/specs/2026-07-16-delivery-retry-design.md").open("a", encoding="utf-8") as handle:
            handle.write(f"\n{E2E_HEADER}\n")
        assert_invalid(duplicate, "complete", duplicate / "output.txt", "duplicates the E2E contract", "matrix ownership")

        missing_link = clone(valid, root, "missing-matrix-link")
        spec_path = missing_link / "repo/docs/specs/2026-07-16-delivery-retry-design.md"
        write(
            spec_path,
            spec_path.read_text(encoding="utf-8").replace(
                "[delivery retry test matrix](../test-matrix/2026-07-16-delivery-retry-test-matrix.md)",
                "the separate matrix",
            ),
        )
        assert_invalid(
            missing_link,
            "complete",
            missing_link / "output.txt",
            "does not reference the test-matrix",
            "missing matrix link",
        )

        one_pass = clone(valid, root, "one-pass")
        events_path = one_pass / "repo/.eval/review-events.jsonl"
        events = [json.loads(line) for line in events_path.read_text(encoding="utf-8").splitlines()]
        events = [event for event in events if not (event["role"] == "product" and event["verdict"] == "REVISE")]
        write(events_path, "".join(json.dumps(event, sort_keys=True) + "\n" for event in events))
        assert_invalid(one_pass, "complete", one_pass / "output.txt", "revise-and-rerun loop", "review loop")

        invalid_source = clone(valid, root, "invalid-source")
        decision_path = invalid_source / "repo/docs/decisions/2026-07-16-delivery-retry-decisions.md"
        write(decision_path, decision_path.read_text(encoding="utf-8").replace("| review |", "| guessed |", 1))
        assert_invalid(
            invalid_source,
            "complete",
            invalid_source / "output.txt",
            "invalid Source",
            "decision source enum",
        )

        duplicate_id = clone(valid, root, "duplicate-decision-id")
        decision_path = duplicate_id / "repo/docs/decisions/2026-07-16-delivery-retry-decisions.md"
        write(decision_path, decision_path.read_text(encoding="utf-8").replace("| 3 | Engineering review", "| 2 | Engineering review"))
        assert_invalid(
            duplicate_id,
            "complete",
            duplicate_id / "output.txt",
            "unique consecutive",
            "duplicate decision id",
        )

        conflict = root / "conflict-valid"
        conflict.mkdir()
        conflict_output = valid_conflict(conflict)
        assert_valid(conflict, "conflict", conflict_output, "positive conflict")

        advanced = clone(conflict, root, "conflict-advanced")
        write(advanced / "repo/docs/specs/forbidden-design.md", "# Premature spec\n")
        assert_invalid(
            advanced,
            "conflict",
            advanced / "output.txt",
            "advanced past its decision gate",
            "conflict gate",
        )

    print("PASS: 4 positive fixtures and 11 independent mutations")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
