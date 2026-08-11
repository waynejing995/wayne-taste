#!/usr/bin/env python3
"""Calibrate the frozen Wayne Mind Explode checker with valid and mutated trials."""

from __future__ import annotations

import hashlib
import json
import re
import shutil
import subprocess
import tempfile
from pathlib import Path

import decision_log
from check_decision_trace import validate_trace
from check_trial import E2E_HEADER, validate


HARNESS = Path(__file__).resolve().parent

TOPIC = "delivery-retry"
RUN_DIR = f".wayne/runs/{TOPIC}"
LOG_REL = f"{RUN_DIR}/decision-log.jsonl"
MATRIX_REL = f"{RUN_DIR}/test-matrix.md"
SPEC_REL = f"docs/specs/{TOPIC}.md"


def seed(workspace: Path, case: str) -> Path:
    repo = workspace / "repo"
    shutil.copytree(HARNESS / "fixture", repo)
    overlay = HARNESS / "cases" / case / "repo"
    if overlay.is_dir():
        shutil.copytree(overlay, repo, dirs_exist_ok=True)
    shutil.copy(HARNESS / "cases" / case / "case.md", repo / "case.md")
    subprocess.run(["git", "-C", str(repo), "init", "-q"], check=True)
    subprocess.run(["git", "-C", str(repo), "config", "user.name", "Eval"], check=True)
    subprocess.run(
        ["git", "-C", str(repo), "config", "user.email", "eval@example.invalid"],
        check=True,
    )
    subprocess.run(["git", "-C", str(repo), "add", "-A"], check=True)
    subprocess.run(["git", "-C", str(repo), "commit", "-qm", "fixture"], check=True)
    return repo


def write(path: Path, text: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding="utf-8")


def patch(path: Path, old: str, new: str) -> None:
    text = path.read_text(encoding="utf-8")
    if old not in text:
        raise AssertionError(f"mutation source missing: {old!r}")
    write(path, text.replace(old, new, 1))


def run_review(repo: Path, role: str, spec: Path) -> str:
    process = subprocess.run(
        ["uv", "run", "--no-project", "python", str(HARNESS / "support" / "review.py"), role, str(spec)],
        cwd=repo,
        check=True,
        capture_output=True,
        text=True,
    )
    return process.stdout


def review_round(number: int, role: str, verdict: str, detail: str) -> dict[str, object]:
    return {
        "type": "decision",
        "id": f"D{number}",
        "question": f"{role.title()} review outcome",
        "decision": f"{verdict} {detail}",
        "rationale": f"the {role} voice read the promoted revision",
        "consequences": None,
        "supersedes": [],
        "source": "review",
        "reference": f"{RUN_DIR}/review-{role}.md",
    }


def complete_records(approved_digest: str) -> list[dict[str, object]]:
    return [
        {
            "type": "meta",
            "topic": TOPIC,
            "status": "design-approved",
            "spec": SPEC_REL,
            "test_matrix": MATRIX_REL,
            "frontier_locked": True,
            "written_spec_approved": True,
            "approved_spec_sha256": approved_digest,
        },
        {
            "type": "decision",
            "id": "D1",
            "question": "Who owns delivery lifecycle state?",
            "decision": "Dispatcher remains the sole owner",
            "rationale": "One lifecycle owner keeps retry transitions observable",
            "consequences": "Retry work cannot be moved off the request path later without a new owner",
            "supersedes": [],
            "source": "codebase",
            "reference": "docs/architecture.md",
        },
        review_round(2, "product", "REVISE:", "every requirement needs an acceptance check"),
        review_round(3, "engineering", "REVISE:", "every decision needs its consequences"),
        review_round(4, "product", "PASS", "on the revised bytes"),
        review_round(5, "engineering", "PASS", "on the revised bytes"),
        {
            "type": "node",
            "id": "N1",
            "parent": None,
            "kind": "fact",
            "decision": "Delivery lifecycle ownership",
            "status": "resolved",
            "opens_when": None,
            "resolved_by": "D1",
        },
    ]


def matrix_text() -> str:
    return f"""# Delivery Retry Test Matrix

## Unit / Integration Matrix

| ID | Behavior | Expected |
|---|---|---|
| S1 | transient failure | bounded retry |

## E2E Verification Contract

{E2E_HEADER}
|---|---|---|---|---|---|
| E1 | CLI: dispatch | transient endpoint | submit delivery | terminal result is visible | ⬜ |
"""


def spec_text(*, acceptance: bool, consequences: bool) -> str:
    acceptance_line = (
        "- **Acceptance** — three attempts are observed, then one terminal FAILED result\n"
        if acceptance
        else ""
    )
    consequences_line = (
        "- **Consequences** — retry work cannot move off the request path without a new owner\n"
        if consequences
        else ""
    )
    return f"""---
type: Design Spec
title: Bounded delivery retry
status: stable
generated: {{ by: eval/1, at: 2026-07-16T00:00:00Z }}
---

# Bounded delivery retry

## TL;DR

Transient delivery failures retry a bounded number of times inside the existing
owner, and a terminal failure stays visible.

## Problem

A transient transport failure ends the delivery permanently, so operators replay
by hand.

## Goals

- A transient failure recovers without operator action.

## Non-goals

- New storage. — retry state fits the existing owner.
- Distributed workers. — out of scope for this change.

## Requirements

### R1 — Transient delivery failures retry up to three times

- **Current** — a transient failure ends the delivery immediately
- **Target** — up to three attempts with deterministic exponential backoff
{acceptance_line}
## Architecture

```mermaid
flowchart LR
    Caller["Caller"] -->|"submit"| Dispatcher["Dispatcher"]
    Dispatcher -->|"attempt"| Transport["Transport"]
```

Plant: delivery execution. Controller: Dispatcher. Setpoint: terminal delivery.
Disturbance: transient transport failure. Feedback: attempt outcome.

| State | Owner | Storage |
|---|---|---|
| delivery status | Dispatcher | existing delivery record |

## Technology and frameworks

| Choice | Origin | Role | Why | Constraint / trade-off |
|---|---|---|---|---|
| existing transport client | inherited | issues the delivery | already the only caller | no native retry hook |

## Interfaces

```python
def submit(delivery_id: str) -> DeliveryResult: ...
```

```python
result = submit("d-1")  # DeliveryResult(status="FAILED", attempts=3)
```

## Failure and concurrency

| Failure | Behavior | Recovery |
|---|---|---|
| transport timeout | retried, bounded | terminal FAILED after three attempts |

## Observability

Each attempt logs its ordinal and outcome at INFO.

## Rollback

Remove the retry command path while retaining existing states.

## Verification

| Requirement | Scenario | Proof |
|---|---|---|
| R1 | a transient failure retries and then fails loudly | [e2e](../../tests/e2e/test_retry.py) |

## Decisions

### D1 — Dispatcher remains the sole delivery lifecycle owner

One lifecycle owner keeps retry transitions observable and controllable.

{consequences_line}- **Decided** — 2026-07-16, by codebase
"""


def valid_complete(workspace: Path, case: str = "complete") -> Path:
    """Walk the real lifecycle: stage, approve, promote, review, revise, repeat."""
    repo = seed(workspace, case)
    candidate = repo / f"{RUN_DIR}/spec.md"
    page = repo / SPEC_REL
    write(repo / MATRIX_REL, matrix_text())

    # Round one: the candidate is approved and promoted, then both voices revise.
    write(candidate, spec_text(acceptance=False, consequences=False))
    page.parent.mkdir(parents=True, exist_ok=True)
    candidate.replace(page)
    run_review(repo, "product", page)
    run_review(repo, "engineering", page)

    # A REVISE returns the page to the run directory before it is edited.
    page.replace(candidate)
    write(candidate, spec_text(acceptance=True, consequences=True))
    candidate.replace(page)
    write(repo / f"{RUN_DIR}/review-product.md", run_review(repo, "product", page))
    write(repo / f"{RUN_DIR}/review-engineering.md", run_review(repo, "engineering", page))

    write(
        repo / LOG_REL,
        decision_log.dump(complete_records(hashlib.sha256(page.read_bytes()).hexdigest())),
    )
    write(
        repo / ".wayne/checkpoints/handoff.md",
        f"""status: design-approved
next_agent: wayne-plan
decision_log: {LOG_REL}
spec: {SPEC_REL}
test_matrix: {MATRIX_REL}
next_prompt: Read the decision log, spec, and test matrix and create the implementation plan.
""",
    )
    output = workspace / "output.txt"
    write(
        output,
        f"设计已完成：`{LOG_REL}`、`{SPEC_REL}`、`{MATRIX_REL}`。下一步调用 wayne-plan。",
    )
    return output


def valid_conflict(workspace: Path) -> Path:
    repo = seed(workspace, "conflict")
    write(
        repo / ".wayne/runs/durable-pause/decision-log.jsonl",
        decision_log.dump(
            [
                {
                    "type": "meta",
                    "topic": "durable-pause",
                    "status": "in-progress",
                    "spec": None,
                    "test_matrix": None,
                    "frontier_locked": False,
                    "written_spec_approved": False,
                    "approved_spec_sha256": None,
                },
                {
                    "type": "decision",
                    "id": "D1",
                    "question": "Do R1 and R2 hold together?",
                    "decision": "They conflict; the user must choose",
                    "rationale": "Durable pause and stateless workers are incompatible",
                    "consequences": "The design cannot proceed until one is dropped",
                    "supersedes": [],
                    "source": "constraint",
                    "reference": None,
                },
                {
                    "type": "node",
                    "id": "N1",
                    "parent": None,
                    "kind": "choice",
                    "decision": "Which requirement survives the conflict",
                    "status": "open",
                    "opens_when": None,
                    "resolved_by": None,
                },
            ]
        ),
    )
    output = workspace / "output.txt"
    write(
        output,
        "检测到 R1 与 R2 冲突。My recommendation: 保留 R2，并把持久化暂停移出本次范围。你同意吗？",
    )
    return output


def valid_decision_locked(workspace: Path) -> Path:
    seed(workspace, "decision-locked")
    output = workspace / "output.txt"
    write(
        output,
        "决策已锁定，但设计章节尚未批准。My recommendation: 先批准架构与状态所有权章节。你批准这一设计章节吗？",
    )
    return output


def depth_log(repo: Path) -> Path:
    return repo / ".wayne/runs/webhook-depth/decision-log.jsonl"


def valid_depth_recommendation(workspace: Path) -> Path:
    repo = seed(workspace, "depth-recommendation")
    path = depth_log(repo)
    records = [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines()]
    records.append(
        {
            "type": "decision",
            "id": "D3",
            "question": "Delivery topology",
            "decision": "Use the existing queue",
            "rationale": "User chose queue delivery",
            "consequences": "Delivery leaves the request path and needs its own frontier",
            "supersedes": [],
            "source": "user",
            "reference": None,
        }
    )
    for record in records:
        if record.get("type") == "node" and record.get("id") == "N3":
            record["status"] = "resolved"
            record["resolved_by"] = "D3"
    for number, description in (
        (4, "Delivery guarantee and idempotency ownership"),
        (5, "Worker acknowledgement and lifecycle ownership boundary"),
        (6, "Queue capacity and backpressure behavior"),
    ):
        records.append(
            {
                "type": "node",
                "id": f"N{number}",
                "parent": "N3",
                "kind": "choice",
                "decision": description,
                "status": "open" if number == 4 else "blocked",
                "opens_when": "N3 = queue" if number == 4 else "N4 resolved",
                "resolved_by": None,
            }
        )
    write(path, decision_log.dump(records))
    output = workspace / "output.txt"
    write(
        output,
        "My recommendation: 先决定至少一次投递与 Dispatcher 幂等。关键假设是可靠性优先。"
        "最强备选是 receiver-owned idempotency，优势是发送端更简单；如果接收方不能稳定保存 key，我会改变推荐。"
        "你选择 Dispatcher 还是 receiver 负责幂等？",
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


def schema_mutations(valid: Path, root: Path) -> None:
    """The JSONL contract rules a producer is most likely to break."""
    lanes = [
        ("bad-json", lambda path: path.write_text(
            path.read_text(encoding="utf-8") + '{"type":"decision"\n', encoding="utf-8"
        ), "is not JSON"),
        ("loose-json", lambda path: patch(
            path,
            '{"type":"node","id":"N1"',
            '{"type": "node", "id": "N1"',
        ), "not compact JSON"),
        ("extra-key", lambda path: patch(
            path, '"source":"codebase"', '"source":"codebase","note":"extra"'
        ), "unknown keys"),
        ("missing-key", lambda path: patch(
            path,
            '"consequences":"Retry work cannot be moved off the request path later without a new owner",',
            "",
        ), "omits"),
        ("dangling-resolved-by", lambda path: patch(
            path, '"resolved_by":"D1"', '"resolved_by":"D9"'
        ), "does not exist"),
        ("second-meta", lambda path: path.write_text(
            path.read_text(encoding="utf-8")
            + decision_log.dumps(
                {"type": "meta", "topic": TOPIC, "status": "in-progress", "spec": None, "test_matrix": None}
            )
            + "\n",
            encoding="utf-8",
        ), "must be the first line"),
        ("invalid-source", lambda path: patch(path, '"source":"review"', '"source":"guessed"'), "invalid source"),
        ("duplicate-decision-id", lambda path: patch(path, '"id":"D3"', '"id":"D2"'), "unique and consecutive"),
        ("open-node-resolved-by", lambda path: patch(
            path, '"status":"resolved","opens_when":null,"resolved_by":"D1"',
            '"status":"open","opens_when":null,"resolved_by":"D1"',
        ), "carries resolved_by"),
    ]
    for name, mutate, needle in lanes:
        trial = clone(valid, root, name)
        mutate(trial / "repo" / LOG_REL)
        assert_invalid(trial, "complete", trial / "output.txt", needle, name)


def main() -> int:
    with tempfile.TemporaryDirectory(prefix="mind-explode-calibration-") as temp:
        root = Path(temp)
        valid = root / "valid"
        valid.mkdir()
        output = valid_complete(valid)
        assert_valid(valid, "complete", output, "positive complete")

        for provider, name in (
            ("codex", "codex-valid.log"),
            ("claude", "claude-valid.jsonl"),
            ("codex", "codex-multi-entity.log"),
            ("claude", "claude-multi-entity.jsonl"),
        ):
            findings = validate_trace(HARNESS / "trace-fixtures" / name, provider)
            if findings:
                raise AssertionError(f"positive {name} should pass: {findings}")

        for provider, name in (("codex", "codex-batch.log"), ("claude", "claude-batch.jsonl")):
            findings = validate_trace(HARNESS / "trace-fixtures" / name, provider)
            if not any("appended 2 decisions" in finding for finding in findings):
                raise AssertionError(f"batched {provider} trace was not rejected: {findings}")

        schema_mutations(valid, root)

        missing_voice = clone(valid, root, "missing-voice")
        (missing_voice / "repo" / f"{RUN_DIR}/review-engineering.md").unlink()
        assert_invalid(
            missing_voice,
            "complete",
            missing_voice / "output.txt",
            "missing final engineering review report",
            "missing voice",
        )

        stale = clone(valid, root, "stale-review")
        with (stale / "repo" / SPEC_REL).open("a", encoding="utf-8") as handle:
            handle.write("\nUnreviewed change.\n")
        assert_invalid(stale, "complete", stale / "output.txt", "did not pass the final spec revision", "stale review")

        plan = clone(valid, root, "plan-written")
        write(plan / "repo/docs/plans/implementation.md", "# Forbidden plan\n")
        assert_invalid(plan, "complete", plan / "output.txt", "implementation plan written", "plan boundary")

        duplicate = clone(valid, root, "duplicate-e2e")
        with (duplicate / "repo" / SPEC_REL).open("a", encoding="utf-8") as handle:
            handle.write(f"\n{E2E_HEADER}\n")
        assert_invalid(duplicate, "complete", duplicate / "output.txt", "duplicates the E2E contract", "matrix ownership")

        unproven = clone(valid, root, "unproven-requirement")
        patch(unproven / "repo" / SPEC_REL, "| R1 | a transient failure", "| R2 | a transient failure")
        assert_invalid(
            unproven,
            "complete",
            unproven / "output.txt",
            "R1 has 0 verification proofs",
            "requirement traceability",
        )

        unnumbered = clone(valid, root, "unnumbered-requirements")
        patch(unnumbered / "repo" / SPEC_REL, "### R1 — Transient", "### Transient")
        assert_invalid(
            unnumbered,
            "complete",
            unnumbered / "output.txt",
            "no numbered R<n> requirements",
            "requirement namespace",
        )

        undrawn = clone(valid, root, "no-diagram")
        patch(undrawn / "repo" / SPEC_REL, "```mermaid", "```text")
        assert_invalid(
            undrawn,
            "complete",
            undrawn / "output.txt",
            "no mermaid architecture diagram",
            "diagram",
        )

        draft = clone(valid, root, "draft-spec")
        patch(draft / "repo" / SPEC_REL, "status: stable", "status: draft")
        assert_invalid(draft, "complete", draft / "output.txt", "status=['draft']", "spec lifecycle")

        no_tech = clone(valid, root, "no-technology")
        patch(no_tech / "repo" / SPEC_REL, "## Technology and frameworks", "## Notes")
        assert_invalid(
            no_tech,
            "complete",
            no_tech / "output.txt",
            "omits ## Technology and frameworks",
            "technology choices",
        )

        no_usage = clone(valid, root, "no-usage-example")
        patch(
            no_usage / "repo" / SPEC_REL,
            '''```python
result = submit("d-1")  # DeliveryResult(status="FAILED", attempts=3)
```
''',
            "",
        )
        assert_invalid(
            no_usage,
            "complete",
            no_usage / "output.txt",
            "without an illustrative call",
            "interface usage example",
        )

        # A seeded-finding case must show the loop; a clean first draft need not.
        banned = root / "gstack-ban-valid"
        banned.mkdir()
        banned_output = valid_complete(banned, "gstack-ban")
        assert_valid(banned, "gstack-ban", banned_output, "positive gstack-ban")

        one_pass = clone(banned, root, "one-pass")
        events_path = one_pass / "repo/.eval/review-events.jsonl"
        events = [json.loads(line) for line in events_path.read_text(encoding="utf-8").splitlines()]
        events = [event for event in events if not (event["role"] == "product" and event["verdict"] == "REVISE")]
        write(events_path, "".join(json.dumps(event, sort_keys=True) + "\n" for event in events))
        assert_invalid(one_pass, "gstack-ban", one_pass / "output.txt", "revise-and-rerun loop", "review loop")

        no_final_pass = clone(valid, root, "no-final-pass")
        events_path = no_final_pass / "repo/.eval/review-events.jsonl"
        events = [json.loads(line) for line in events_path.read_text(encoding="utf-8").splitlines()]
        for event in reversed(events):
            if event["role"] == "engineering":
                event["verdict"] = "REVISE"
                break
        write(events_path, "".join(json.dumps(event, sort_keys=True) + "\n" for event in events))
        assert_invalid(
            no_final_pass,
            "complete",
            no_final_pass / "output.txt",
            "final verdict is not PASS",
            "review outcome",
        )

        dated_spec = clone(valid, root, "dated-spec")
        shutil.move(
            dated_spec / "repo" / SPEC_REL,
            dated_spec / "repo/docs/specs/2026-07-16-delivery-retry-design.md",
        )
        patch(
            dated_spec / "repo" / LOG_REL,
            f'"spec":"{SPEC_REL}"',
            '"spec":"docs/specs/2026-07-16-delivery-retry-design.md"',
        )
        assert_invalid(
            dated_spec,
            "complete",
            dated_spec / "output.txt",
            "is not a living page",
            "living-page spec",
        )

        # --- the seven lanes the follow-up review demanded -------------------
        external = clone(valid, root, "external-resolution")
        patch(
            external / "repo" / LOG_REL,
            '"resolved_by":"D1"',
            '"resolved_by":"authentication:D7"',
        )
        assert_valid(external, "complete", external / "output.txt", "external resolved_by")

        bad_external = clone(valid, root, "malformed-resolution")
        patch(bad_external / "repo" / LOG_REL, '"resolved_by":"D1"', '"resolved_by":"D one"')
        assert_invalid(
            bad_external,
            "complete",
            bad_external / "output.txt",
            "is malformed",
            "resolved_by syntax",
        )

        unsourced_web = clone(valid, root, "unsourced-web-fact")
        patch(
            unsourced_web / "repo" / LOG_REL,
            '"source":"codebase","reference":"docs/architecture.md"',
            '"source":"web","reference":null',
        )
        assert_invalid(
            unsourced_web,
            "complete",
            unsourced_web / "output.txt",
            "carries no source URL",
            "web provenance",
        )

        unlocked = clone(valid, root, "approved-without-lock")
        patch(unlocked / "repo" / LOG_REL, '"frontier_locked":true', '"frontier_locked":false')
        assert_invalid(
            unlocked,
            "complete",
            unlocked / "output.txt",
            "approved while the frontier is unlocked",
            "lock precedes approval",
        )

        no_target = clone(valid, root, "requirement-missing-target")
        patch(
            no_target / "repo" / SPEC_REL,
            "- **Target** — up to three attempts with deterministic exponential backoff\n",
            "",
        )
        assert_invalid(
            no_target,
            "complete",
            no_target / "output.txt",
            "R1 carries 0 Target lines",
            "requirement completeness",
        )

        copied = clone(valid, root, "copied-not-moved")
        write(copied / "repo" / f"{RUN_DIR}/spec.md", (copied / "repo" / SPEC_REL).read_text(encoding="utf-8"))
        assert_invalid(
            copied,
            "complete",
            copied / "output.txt",
            "copied instead of moving",
            "move never copy",
        )

        cross_topic = clone(valid, root, "cross-topic-artifact")
        write(cross_topic / "repo/docs/specs/unrelated.md", "# Unrelated topic\n")
        assert_invalid(
            cross_topic,
            "complete",
            cross_topic / "output.txt",
            "unexpected file outside design outputs: docs/specs/unrelated.md",
            "topic-bound outputs",
        )

        tampered_report = clone(valid, root, "tampered-review-digest")
        report = tampered_report / "repo" / f"{RUN_DIR}/review-product.md"
        write(
            report,
            re.sub(r"^SHA256: .*$", "SHA256: " + "0" * 64, report.read_text(encoding="utf-8"), flags=re.MULTILINE),
        )
        assert_invalid(
            tampered_report,
            "complete",
            tampered_report / "output.txt",
            "does not name the final spec digest",
            "review digest correlation",
        )

        orphan_outcome = clone(valid, root, "unreferenced-review-outcome")
        patch(
            orphan_outcome / "repo" / LOG_REL,
            f'"reference":"{RUN_DIR}/review-engineering.md"',
            '"reference":null',
        )
        assert_invalid(
            orphan_outcome,
            "complete",
            orphan_outcome / "output.txt",
            "but the log records ['PASS']",
            "review round accounting",
        )

        dangling = clone(valid, root, "dangling-reference")
        patch(dangling / "repo" / LOG_REL, '"reference":"docs/architecture.md"', '"reference":"docs/gone.md"')
        assert_invalid(
            dangling,
            "complete",
            dangling / "output.txt",
            "references a path that does not exist",
            "reference resolves",
        )

        phantom = clone(valid, root, "phantom-external-decision")
        patch(phantom / "repo" / LOG_REL, '"resolved_by":"D1"', '"resolved_by":"authentication:D999"')
        assert_invalid(
            phantom,
            "complete",
            phantom / "output.txt",
            "cites a decision the spec does not carry",
            "external citation resolves",
        )

        unresolved = clone(valid, root, "revise-not-resolved")
        patch(
            unresolved / "repo" / LOG_REL,
            '"id":"D4","question":"Product review outcome","decision":"PASS on the revised bytes"',
            '"id":"D4","question":"Product review outcome","decision":"REVISE again"',
        )
        assert_invalid(
            unresolved,
            "complete",
            unresolved / "output.txt",
            "last logged product review outcome is not a PASS",
            "review round resolution",
        )

        stale_seed = clone(valid, root, "stale-external-seed")
        patch(stale_seed / "repo" / LOG_REL, '"resolved_by":"D1"', '"resolved_by":"authentication:D7"')
        patch(
            stale_seed / "repo/docs/specs/authentication.md",
            "generated: { by: human:wayne, at: 2026-05-02T00:00:00Z }",
            "generated: { by: human:wayne, at: 2026-06-01T00:00:00Z }",
        )
        assert_invalid(
            stale_seed,
            "complete",
            stale_seed / "output.txt",
            "edited after it was last confirmed",
            "external seed freshness",
        )

        deprecated_seed = clone(valid, root, "deprecated-external-seed")
        patch(deprecated_seed / "repo" / LOG_REL, '"resolved_by":"D1"', '"resolved_by":"authentication:D7"')
        patch(
            deprecated_seed / "repo/docs/specs/authentication.md",
            "status: stable",
            "status: deprecated",
        )
        assert_invalid(
            deprecated_seed,
            "complete",
            deprecated_seed / "output.txt",
            "not ['stable']",
            "external seed in force",
        )

        no_outcome = clone(valid, root, "no-review-outcome")
        log_text = (no_outcome / "repo" / LOG_REL).read_text(encoding="utf-8")
        write(
            no_outcome / "repo" / LOG_REL,
            log_text.replace(f'"reference":"{RUN_DIR}/review-engineering.md"', '"reference":null'),
        )
        assert_invalid(
            no_outcome,
            "complete",
            no_outcome / "output.txt",
            "holds no engineering review outcome",
            "review outcome ownership",
        )

        # A design this pipeline just produced has no `verified` entry; it must
        # still be citable, which is the rule the previous revision made impossible.
        never_run = clone(valid, root, "never-run-external-seed")
        patch(never_run / "repo" / LOG_REL, '"resolved_by":"D1"', '"resolved_by":"queueing:D2"')
        assert_valid(never_run, "complete", never_run / "output.txt", "never-run spec is citable")

        conflict = root / "conflict-valid"
        conflict.mkdir()
        conflict_output = valid_conflict(conflict)
        assert_valid(conflict, "conflict", conflict_output, "positive conflict")

        advanced = clone(conflict, root, "conflict-advanced")
        write(advanced / "repo/docs/specs/durable-pause.md", "# Premature spec\n")
        assert_invalid(
            advanced,
            "conflict",
            advanced / "output.txt",
            "advanced past its gate",
            "conflict gate",
        )

        locked = root / "decision-locked-valid"
        locked.mkdir()
        locked_output = valid_decision_locked(locked)
        assert_valid(locked, "decision-locked", locked_output, "positive decision lock")

        locked_source = clone(locked, root, "decision-locked-source-edit")
        source = locked_source / "repo/src/dispatcher.py"
        write(source, source.read_text(encoding="utf-8") + "\n# implemented after lock\n")
        assert_invalid(
            locked_source,
            "decision-locked",
            locked_source / "output.txt",
            "source input modified",
            "decision lock source boundary",
        )

        locked_spec = clone(locked, root, "decision-locked-spec")
        write(locked_spec / "repo/docs/specs/queued-webhook.md", "# Premature\n")
        assert_invalid(
            locked_spec,
            "decision-locked",
            locked_spec / "output.txt",
            "advanced past its gate",
            "decision lock approval gate",
        )

        locked_questions = clone(locked, root, "decision-locked-two-questions")
        write(locked_questions / "output.txt", "My recommendation: approve design. Approve architecture? Start implementation?")
        assert_invalid(
            locked_questions,
            "decision-locked",
            locked_questions / "output.txt",
            "ask exactly one question",
            "decision lock question count",
        )

        locked_promoted = clone(locked, root, "decision-locked-promoted")
        patch(
            locked_promoted / "repo/.wayne/runs/queued-webhook/decision-log.jsonl",
            '"status":"in-progress"',
            '"status":"design-approved"',
        )
        assert_invalid(
            locked_promoted,
            "decision-locked",
            locked_promoted / "output.txt",
            "promoted to design-approved",
            "decision lock status gate",
        )

        locked_reopened = clone(locked, root, "decision-locked-reopened")
        patch(
            locked_reopened / "repo/.wayne/runs/queued-webhook/decision-log.jsonl",
            '"decision":"Exhaustion behavior and operator recovery","status":"resolved","opens_when":"N3 resolved","resolved_by":"D4"',
            '"decision":"Exhaustion behavior and operator recovery","status":"open","opens_when":"N3 resolved","resolved_by":null',
        )
        assert_invalid(
            locked_reopened,
            "decision-locked",
            locked_reopened / "output.txt",
            "reopened nodes",
            "decision lock frontier",
        )

        depth = root / "depth-valid"
        depth.mkdir()
        depth_output = valid_depth_recommendation(depth)
        assert_valid(depth, "depth-recommendation", depth_output, "positive depth recommendation")

        depth_child = clone(depth, root, "depth-missing-child")
        path = depth_log(depth_child / "repo")
        write(
            path,
            "".join(
                f"{line}\n"
                for line in path.read_text(encoding="utf-8").splitlines()
                if "Queue capacity and backpressure behavior" not in line
            ),
        )
        assert_invalid(
            depth_child,
            "depth-recommendation",
            depth_child / "output.txt",
            "0 capacity/backpressure child nodes",
            "depth child expansion",
        )

        depth_orphan = clone(depth, root, "depth-orphan-child")
        patch(
            depth_log(depth_orphan / "repo"),
            '"id":"N4","parent":"N3"',
            '"id":"N4","parent":"N1"',
        )
        assert_invalid(
            depth_orphan,
            "depth-recommendation",
            depth_orphan / "output.txt",
            "is not a child of N3",
            "depth child parentage",
        )

        depth_leading = clone(depth, root, "depth-leading-question")
        write(
            depth_leading / "output.txt",
            "My recommendation: queue. 前提是可靠性优先。最强备选是 inline，优势是简单；如果吞吐不重要我会改变推荐。你同意吗？",
        )
        assert_invalid(
            depth_leading,
            "depth-recommendation",
            depth_leading / "output.txt",
            "asks for approval",
            "non-leading recommendation",
        )

        depth_reversal = clone(depth, root, "depth-no-reversal")
        write(
            depth_reversal / "output.txt",
            "My recommendation: Dispatcher 幂等。前提是可靠性优先。最强备选是 receiver 幂等，优势是发送端简单。你选择哪一个？",
        )
        assert_invalid(
            depth_reversal,
            "depth-recommendation",
            depth_reversal / "output.txt",
            "omits a reversal condition",
            "recommendation reversal",
        )

        depth_amend = clone(depth, root, "depth-amendment-edit")
        page = depth_amend / "repo/docs/specs/webhook-depth.md"
        write(page, page.read_text(encoding="utf-8") + "\nEdited before approval.\n")
        assert_invalid(
            depth_amend,
            "depth-recommendation",
            depth_amend / "output.txt",
            "advanced past its gate: ['docs/specs/webhook-depth.md']",
            "amendment edits the page too early",
        )

        depth_advanced = clone(depth, root, "depth-advanced")
        write(depth_advanced / "repo/docs/specs/other-topic.md", "# Premature\n")
        assert_invalid(
            depth_advanced,
            "depth-recommendation",
            depth_advanced / "output.txt",
            "unexpected file outside design outputs",
            "depth cross-topic source boundary",
        )

    print(
        "PASS: observations cover 8 fixtures and 47 mutations; "
        "semantic verdict remains AI_REVIEW_REQUIRED"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
