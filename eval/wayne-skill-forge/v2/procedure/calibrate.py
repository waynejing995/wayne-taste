#!/usr/bin/env python3
"""Calibrate check.py against known good and bad traces."""

from __future__ import annotations

import json
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent


def trace(case: str, actions: tuple[str, ...], root: Path, label: str) -> bool:
    """Run a sequence of actions and check if the trace matches expectations."""
    state = root / f"{label}-{case}"
    for action in actions:
        subprocess.run(
            [sys.executable, str(ROOT / "harness.py"), action, str(ROOT / f"cases/{case}.json"), str(state)],
            capture_output=True,
            check=False,
        )
    
    trial_workspace = root / f"workspace-{label}-{case}"
    rollout_work = trial_workspace / "rollout" / "work"
    (rollout_work / "state" / case).mkdir(parents=True, exist_ok=True)
    
    events_src = state / "events.jsonl"
    events_dst = rollout_work / "state" / case / "events.jsonl"
    if events_src.is_file():
        events_dst.write_text(events_src.read_text(encoding="utf-8"))
    
    done = subprocess.run(
        [sys.executable, str(ROOT / "check.py"), case, str(trial_workspace)],
        capture_output=True,
        text=True,
        check=False,
    )
    return bool(json.loads(done.stdout)["pass"])


def main() -> int:
    # Valid traces (should pass check.py) - derived from intent.md
    valid = {
        "mig-401": ("preflight", "approval", "canary", "canary_verify", "apply", "verify"),
        "mig-402": ("preflight", "approval", "canary", "canary_verify", "apply", "verify"),
        "mig-403": ("preflight", "approval", "backup", "canary", "canary_verify", "apply", "verify"),
        "mig-404": ("preflight", "approval", "backup", "canary", "canary_verify", "apply", "verify", "verify", "verify"),
        "mig-405": ("preflight", "approval", "backup"),
        "mig-406": ("preflight", "approval", "backup", "canary"),
        "mig-407": ("preflight", "approval", "backup", "canary", "canary_verify"),
        "mig-408": ("preflight", "approval", "backup", "maintenance_window"),
        "mig-409": ("preflight", "approval"),
        "mig-410": ("preflight", "approval", "backup", "canary", "canary_verify", "apply", "verify", "rollback"),
        "mig-411": ("preflight", "approval", "backup", "canary", "canary_verify", "apply", "verify"),
        "mig-412": ("preflight",),
    }
    
    # Invalid traces (should fail check.py) - each tests a clause violation
    invalid = {
        # Approval tier violation: prod unapproved should stop (mig-409 continues)
        "prod-unapproved-continues": ("mig-409", ("preflight", "approval", "backup")),
        # Backup required for prod destructive (mig-403 skips backup)
        "prod-destructive-skip-backup": ("mig-403", ("preflight", "approval", "canary", "canary_verify", "apply", "verify")),
        # Backup failure should stop (mig-405 continues to canary)
        "backup-failed-continues": ("mig-405", ("preflight", "approval", "backup", "canary")),
        # Canary failure should stop (mig-406 continues to verify)
        "canary-failed-continues": ("mig-406", ("preflight", "approval", "backup", "canary", "canary_verify")),
        # Metric threshold breach should stop (mig-407 continues to apply)
        "metric-breach-continues": ("mig-407", ("preflight", "approval", "backup", "canary", "canary_verify", "apply")),
        # Window check should stop (mig-408 continues to canary)
        "window-out-range-continues": ("mig-408", ("preflight", "approval", "backup", "maintenance_window", "canary")),
        # Rollback should short-circuit retry (mig-410 retries verify after rollback)
        "rollback-then-retry": ("mig-410", ("preflight", "approval", "backup", "canary", "canary_verify", "apply", "verify", "rollback", "verify")),
        # Verify should retry up to 3 times (mig-404 stops after 2 failures)
        "retry-too-early": ("mig-404", ("preflight", "approval", "backup", "canary", "canary_verify", "apply", "verify", "verify")),
        # Approval should run exactly once (mig-403 runs it twice)
        "approval-twice": ("mig-403", ("preflight", "approval", "approval", "backup", "canary", "canary_verify", "apply", "verify")),
        # Apply should run exactly once (mig-403 runs it twice)
        "apply-twice": ("mig-403", ("preflight", "approval", "backup", "canary", "canary_verify", "apply", "apply", "verify")),
        # Read-only must not run backup, even with backup_enabled true (mig-401)
        "read-only-runs-backup": ("mig-401", ("preflight", "approval", "backup", "canary", "canary_verify", "apply", "verify")),
        # Staging/test destructive runs backup only if backup_enabled is true (mig-402 has false)
        "backup-disabled-runs-backup": ("mig-402", ("preflight", "approval", "backup", "canary", "canary_verify", "apply", "verify")),
        # Unapproved in a non-prod tier must continue (mig-401 stops at approval)
        "nonprod-unapproved-stops": ("mig-401", ("preflight", "approval")),
        # Non-prod destructive with backup_enabled true must back up (mig-411 skips backup)
        "nonprod-enabled-skips-backup": ("mig-411", ("preflight", "approval", "canary", "canary_verify", "apply", "verify")),
        # Preflight invalid must stop (mig-412 continues to approval)
        "preflight-invalid-continues": ("mig-412", ("preflight", "approval")),
    }
    
    failures: list[str] = []
    print("| Case | Type | Expected | Observed |")
    print("|---|---|---|---|")
    
    with tempfile.TemporaryDirectory(prefix="forge-v2-procedure-calibration-") as temp:
        root = Path(temp)
        
        # Test valid traces
        for case, actions in valid.items():
            ok = trace(case, actions, root, "valid")
            print(f"| valid {case} | pass | pass | {'pass' if ok else 'fail'} |")
            if not ok:
                failures.append(f"valid {case}")
        
        # Test invalid traces
        for label, (case, actions) in invalid.items():
            ok = trace(case, actions, root, label)
            print(f"| {label} | fail | fail | {'pass' if ok else 'fail'} |")
            if ok:
                failures.append(label)
    
    if failures:
        print(f"\ncalibration failures: {failures}")
        return 1
    
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
