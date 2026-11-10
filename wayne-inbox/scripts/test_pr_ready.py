import json
import os
import subprocess
from pathlib import Path

import pytest

SCRIPT = Path(__file__).with_name("pr-ready.sh")
HEAD = "853b384b0b3cdb59b5adec6053d756aae5064fa2"
CLEAN = f"Multi-source auto-review @ {HEAD[:8]} (diff `base...{HEAD[:8]}`): no critical issues found."
GREEN = [{"__typename": "CheckRun", "name": "Backend unit tests", "status": "COMPLETED", "conclusion": "SUCCESS"},
         {"__typename": "CheckRun", "name": "Docs", "status": "COMPLETED", "conclusion": "SKIPPED"}]


def pr(comments, checks=GREEN, mergeable="MERGEABLE"):
    return {"headRefOid": HEAD, "mergeable": mergeable, "reviews": [], "statusCheckRollup": checks,
            "comments": [{"createdAt": at, "body": body} for at, body in comments]}


def run(tmp_path, fixture):
    """pr-ready.sh against a fake `gh` that prints `fixture` as the `gh pr view --json` answer."""
    (tmp_path / "pr.json").write_text(json.dumps(fixture))
    gh = tmp_path / "gh"
    gh.write_text(f'#!/bin/sh\ncat "{tmp_path / "pr.json"}"\n')
    gh.chmod(0o755)
    env = {**os.environ, "PATH": f"{tmp_path}:{os.environ['PATH']}"}
    return subprocess.run([str(SCRIPT), "o/r", "1"], capture_output=True, text=True, env=env)


def gate(out, name):
    return next(line.split()[1] for line in out.splitlines() if line.startswith(name + " "))


def test_ready_when_latest_review_is_clean_on_head_and_checks_pass(tmp_path):
    result = run(tmp_path, pr([("2026-11-10T09:00:00Z", CLEAN)]))
    assert result.returncode == 0, result.stdout + result.stderr
    assert [gate(result.stdout, g) for g in ("review-head", "review-clean", "ci", "mergeable")] == ["ok"] * 4
    assert result.stdout.splitlines()[-1] == "READY"


def test_review_of_an_older_commit_blocks_even_when_an_earlier_one_matched(tmp_path):
    stale = "Multi-source auto-review of 2e80d336b (frozen three-dot diff `00913b76c...2e80d336b`): no critical issue."
    result = run(tmp_path, pr([("2026-11-10T10:00:00Z", stale), ("2026-11-10T09:00:00Z", CLEAN)]))
    assert result.returncode == 1
    assert gate(result.stdout, "review-head") == "FAIL" and "2e80d336b" in result.stdout
    assert result.stdout.splitlines()[-1] == "NOT READY: review-head"


def test_critical_review_on_head_blocks_on_review_clean(tmp_path):
    critical = f"## Multi-source auto-review: PR #1 @ {HEAD[:7]}\n\n### CRITICAL (1, posted inline)\n| # | x |"
    result = run(tmp_path, pr([("2026-11-10T09:00:00Z", critical)]))
    assert result.returncode == 1
    assert gate(result.stdout, "review-head") == "ok" and gate(result.stdout, "review-clean") == "FAIL"
    assert result.stdout.splitlines()[-1] == "NOT READY: review-clean"


def test_running_check_leaves_ci_pending(tmp_path):
    running = GREEN + [{"__typename": "CheckRun", "name": "Repository contracts", "status": "IN_PROGRESS",
                        "conclusion": ""}]
    result = run(tmp_path, pr([("2026-11-10T09:00:00Z", CLEAN)], checks=running))
    assert result.returncode == 1
    assert gate(result.stdout, "ci") == "pending" and "Repository contracts IN_PROGRESS" in result.stdout
    assert result.stdout.splitlines()[-1] == "NOT READY: ci"


@pytest.mark.parametrize("check", [
    {"__typename": "CheckRun", "name": "lint", "status": "COMPLETED", "conclusion": "FAILURE"},
    {"__typename": "StatusContext", "context": "ci/legacy", "state": "ERROR"},
])
def test_failed_check_fails_ci_while_others_still_run(tmp_path, check):
    running = {"__typename": "CheckRun", "name": "slow", "status": "QUEUED", "conclusion": ""}
    result = run(tmp_path, pr([("2026-11-10T09:00:00Z", CLEAN)], checks=GREEN + [running, check]))
    assert result.returncode == 1 and gate(result.stdout, "ci") == "FAIL"


def test_conflicting_pr_is_not_ready(tmp_path):
    result = run(tmp_path, pr([("2026-11-10T09:00:00Z", CLEAN)], mergeable="CONFLICTING"))
    assert result.returncode == 1 and result.stdout.splitlines()[-1] == "NOT READY: mergeable"



def test_head_without_any_check_fails_ci(tmp_path):
    result = run(tmp_path, pr([("2026-11-10T09:00:00Z", CLEAN)], checks=[]))
    assert result.returncode == 1
    assert "ci            FAIL     no checks on head" in result.stdout.splitlines()
    assert result.stdout.splitlines()[-1] == "NOT READY: ci"