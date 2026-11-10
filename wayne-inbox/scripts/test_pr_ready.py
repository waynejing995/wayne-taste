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


# Body shapes of real TRACE auto-reviews (#849 @ 2e80d336b, #833 @ 4d6a8d9, #859, #842), on this fixture's head.
NO_NEW = (f"Multi-source auto-review of {HEAD[:9]} (frozen three-dot diff `00913b76c...{HEAD[:9]}`).\n\n"
          "Since f572cd7f1, the only change is `captain-pi/src/pg-storage.ts:216`.\n\n"
          "**No new CRITICAL issues.** All four sources checked that `max: 1` cannot deadlock:\n"
          "- `close()` drains admitted operations before calling `pool.end()`.\n")
STILL_OPEN_849 = (NO_NEW + "\n**Still open, already posted inline, not re-posted, and not declined by the author:**\n"
                  "- `dispatch.py:104`\n- `app.py:2418`\n\nNot approving while these remain open.\n")
PRIOR_PRESENT_833 = (NO_NEW + "\n**6 prior CRITICALs are still present.** Each has a reply on its existing thread: "
                     "adopt.py:300, reproduce.py:3746.\n")


def verdict(body):
    """The shared rule watch-prs.sh and pr-ready.sh both source."""
    out = subprocess.run(["bash", "-c", f'source "{SCRIPT.with_name("auto-review.sh")}"; '
                          'jq -r --arg auto "$AUTO" "$AUTO_JQ"'],
                         input=json.dumps({"body": body}), capture_output=True, text=True, check=True).stdout
    return out.splitlines()[0]


@pytest.mark.parametrize("body, want", [
    (NO_NEW, "clean"),
    (STILL_OPEN_849, "critical"),
    (PRIOR_PRESENT_833, "critical"),
    (NO_NEW + "\n**2 new CRITICALs, posted inline:**\n- adopt.py:662\n", "critical"),
    (NO_NEW + "\n**CRITICAL (1, still open):** `activities.py:1395`.\n", "critical"),
    (NO_NEW + "\n### CRITICAL candidate downgraded after checking\n| Finding | Voice 2 (CRITICAL 10) |\n", "clean"),
    (NO_NEW + "\n### Raised as CRITICAL, downgraded after checking\n- x\n", "clean"),
    (NO_NEW + "\n### CRITICAL\nNone. Voice 2 marked six items CRITICAL.\n", "critical"),
    (NO_NEW + "\nAll earlier criticals (`_do_resync` race) are still fixed at this head.\n", "clean"),
    ("Multi-source auto-review @ abc1234: two findings, see inline.", "critical"),
], ids=["no-new", "849-still-open", "833-prior-present", "new-criticals", "critical-still-open",
        "candidate-downgraded", "raised-as-downgraded", "critical-heading", "earlier-still-fixed", "silent"])
def test_verdict_rule(body, want):
    assert verdict(body) == f"verdict={want}"


def test_no_new_critical_on_head_is_ready_but_old_criticals_still_open_are_not(tmp_path):
    assert run(tmp_path, pr([("2026-11-10T09:00:00Z", NO_NEW)])).stdout.splitlines()[-1] == "READY"
    result = run(tmp_path, pr([("2026-11-10T09:00:00Z", STILL_OPEN_849)]))
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