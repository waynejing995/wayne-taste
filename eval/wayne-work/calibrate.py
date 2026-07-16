#!/usr/bin/env python3
"""Calibrate Wayne Work success and blocking gates."""

from __future__ import annotations

import json
import os
import shutil
import subprocess
import tempfile
from pathlib import Path

from check_trial import MATRIX, PLAN, validate


HARNESS = Path(__file__).resolve().parent


MODELS = '''from __future__ import annotations

from dataclasses import dataclass
from enum import Enum


class DeliveryStatus(str, Enum):
    QUEUED = "queued"
    RETRY_PENDING = "retry_pending"
    DELIVERED = "delivered"
    FAILED = "failed"


@dataclass
class Delivery:
    delivery_id: str
    payload: str
    status: DeliveryStatus = DeliveryStatus.QUEUED
    attempts: int = 0


@dataclass(frozen=True)
class RetryPolicy:
    max_attempts: int
    backoff_seconds: tuple[float, ...]

    def __post_init__(self) -> None:
        if self.max_attempts < 1:
            raise ValueError("max_attempts must be at least 1")
        if len(self.backoff_seconds) != self.max_attempts - 1:
            raise ValueError("backoff schedule must have max_attempts - 1 entries")
        if any(delay < 0 for delay in self.backoff_seconds):
            raise ValueError("backoff delays must be non-negative")

    def delay_after(self, failed_attempt: int) -> float:
        if failed_attempt < 1 or failed_attempt >= self.max_attempts:
            raise ValueError("failed_attempt has no retry delay")
        return self.backoff_seconds[failed_attempt - 1]
'''

SERVICE = '''from __future__ import annotations

from collections.abc import Callable

from relay.models import Delivery, DeliveryStatus, RetryPolicy
from relay.store import InMemoryStore


class DeliveryService:
    def __init__(
        self,
        store: InMemoryStore,
        send: Callable[[str], None],
        sleep: Callable[[float], None],
    ) -> None:
        self._store = store
        self._send = send
        self._sleep = sleep

    def deliver(self, delivery_id: str, payload: str, policy: RetryPolicy) -> Delivery:
        existing = self._store.get(delivery_id)
        if existing is not None and existing.status is DeliveryStatus.DELIVERED:
            return existing

        delivery = existing or Delivery(delivery_id=delivery_id, payload=payload)
        for attempt in range(1, policy.max_attempts + 1):
            delivery.attempts = attempt
            try:
                self._send(delivery.payload)
            except TimeoutError:
                if attempt == policy.max_attempts:
                    delivery.status = DeliveryStatus.FAILED
                    self._store.save(delivery)
                    raise
                delivery.status = DeliveryStatus.RETRY_PENDING
                self._store.save(delivery)
                self._sleep(policy.delay_after(attempt))
            except Exception:
                delivery.status = DeliveryStatus.FAILED
                self._store.save(delivery)
                raise
            else:
                delivery.status = DeliveryStatus.DELIVERED
                self._store.save(delivery)
                return delivery
        raise AssertionError("unreachable")
'''

INIT = '''from relay.models import Delivery, DeliveryStatus, RetryPolicy
from relay.service import DeliveryService
from relay.store import InMemoryStore

__all__ = ["Delivery", "DeliveryService", "DeliveryStatus", "InMemoryStore", "RetryPolicy"]
'''


def write(path: Path, text: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding="utf-8")


def seed(workspace: Path, case: str) -> Path:
    repo = workspace / "repo"
    ignore = shutil.ignore_patterns("__pycache__", "*.pyc")
    shutil.copytree(HARNESS / "fixture", repo, ignore=ignore)
    shutil.copytree(HARNESS / "cases" / case, repo, dirs_exist_ok=True, ignore=ignore)
    subprocess.run(["git", "init", "-q"], cwd=repo, check=True)
    subprocess.run(["git", "config", "user.name", "Eval Fixture"], cwd=repo, check=True)
    subprocess.run(["git", "config", "user.email", "eval@example.invalid"], cwd=repo, check=True)
    subprocess.run(["git", "add", "."], cwd=repo, check=True)
    subprocess.run(["git", "commit", "-q", "-m", "fixture: approved retry plan"], cwd=repo, check=True)
    subprocess.run(["git", "branch", "-M", "main"], cwd=repo, check=True)
    return repo


def run_verify(repo: Path, phase: str) -> int:
    return subprocess.run(
        ["uv", "run", "--no-project", "python", "scripts/verify.py", phase],
        cwd=repo,
        env={**os.environ, "PYTHONPATH": "src"},
    ).returncode


def valid_normal(workspace: Path) -> Path:
    repo = seed(workspace, "normal")
    if run_verify(repo, "unit") == 0:
        raise AssertionError("seeded RED verification unexpectedly passed")
    write(repo / "src/relay/models.py", MODELS)
    write(repo / "src/relay/service.py", SERVICE)
    write(repo / "src/relay/__init__.py", INIT)
    matrix = repo / MATRIX
    write(matrix, matrix.read_text(encoding="utf-8").replace("☐", "☑"))
    if run_verify(repo, "unit") != 0 or run_verify(repo, "full") != 0:
        raise AssertionError("calibration implementation did not turn GREEN")
    write(
        repo / ".wayne/checkpoints/handoff.md",
        f"""status: built
next_agent: wayne-code-review
plan: {PLAN}
matrix: {MATRIX}
completed_units: I1, I2
verification: uv run --no-project python scripts/verify.py full — PASS
changed: src/relay/models.py; src/relay/service.py; src/relay/__init__.py
out of scope: tests, E rows, commits, branches, and downstream review.
""",
    )
    output = workspace / "output.txt"
    write(output, "实现完成，tests 通过；下一步 wayne-code-review。")
    return output


def valid_blocked(workspace: Path, case: str) -> Path:
    seed(workspace, case)
    reason = "PLAN_SCOPE_CONFLICT" if case == "protected" else "MISSING_U_ROW"
    artifacts = f"case.md;{PLAN}" if case == "protected" else f"{PLAN};{MATRIX}"
    output = workspace / "output.txt"
    write(
        output,
        f"STATUS: BLOCKED\nREASON: {reason}\nARTIFACTS: {artifacts}\nOWNER: planning\n批准输入存在冲突，请规划 owner 修复后重试。",
    )
    return output


def assert_valid(workspace: Path, case: str, output: Path) -> None:
    findings = validate(workspace, case, output)
    if findings:
        raise AssertionError(f"valid {case} failed: {findings}")


def assert_invalid(workspace: Path, output: Path, needle: str, label: str) -> None:
    findings = validate(workspace, "normal", output)
    if not any(needle in finding for finding in findings):
        raise AssertionError(f"{label} missing {needle!r}: {json.dumps(findings, ensure_ascii=False)}")


def clone(source: Path, root: Path, name: str) -> Path:
    target = root / name
    shutil.copytree(source, target)
    return target


def main() -> int:
    with tempfile.TemporaryDirectory(prefix="wayne-work-calibration-") as temp:
        root = Path(temp)
        normal = root / "normal"
        normal.mkdir()
        normal_output = valid_normal(normal)
        assert_valid(normal, "normal", normal_output)

        for case in ("protected", "missing-u"):
            workspace = root / case
            workspace.mkdir()
            output = valid_blocked(workspace, case)
            assert_valid(workspace, case, output)

        test_edit = clone(normal, root, "test-edit")
        with (test_edit / "repo/tests/test_retry_contract.py").open("a", encoding="utf-8") as handle:
            handle.write("\n# weakened\n")
        assert_invalid(test_edit, test_edit / "output.txt", "unapproved paths", "locked test")

        u_open = clone(normal, root, "u-open")
        matrix = u_open / "repo" / MATRIX
        write(matrix, matrix.read_text(encoding="utf-8").replace("| ☑ |", "| ☐ |", 1))
        assert_invalid(u_open, u_open / "output.txt", "not every U row", "U ownership")

        e_changed = clone(normal, root, "e-changed")
        matrix = e_changed / "repo" / MATRIX
        write(matrix, matrix.read_text(encoding="utf-8").replace("| ⬜ |", "| ✅ |", 1))
        assert_invalid(e_changed, e_changed / "output.txt", "changed E status", "E ownership")

        no_red = clone(normal, root, "no-red")
        events_path = no_red / "repo/.eval/verify-events.jsonl"
        events = events_path.read_text(encoding="utf-8").splitlines()
        write(events_path, "\n".join(events[1:]) + "\n")
        assert_invalid(no_red, no_red / "output.txt", "expected RED", "test-first gate")

        extra = clone(normal, root, "scope-extra")
        write(extra / "repo/src/relay/retry_helper.py", "# unplanned abstraction\n")
        assert_invalid(extra, extra / "output.txt", "unapproved paths", "scope diff")

        committed = clone(normal, root, "committed")
        subprocess.run(["git", "add", "."], cwd=committed / "repo", check=True)
        subprocess.run(["git", "commit", "-q", "-m", "forbidden"], cwd=committed / "repo", check=True)
        assert_invalid(committed, committed / "output.txt", "created commits", "commit boundary")

    print("PASS: 3 positive cases and 6 independent mutations")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
