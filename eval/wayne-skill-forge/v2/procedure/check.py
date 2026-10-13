#!/usr/bin/env python3
"""Checker for multi-tier schema rollout event sequences."""

from __future__ import annotations

import argparse
import json
from pathlib import Path

# Expected event sequences for each case, derived from intent.md clauses
EXPECTED = {
    "mig-401": [
        ("preflight", "valid"),
        ("approval", "unapproved"),
        ("canary", "canary_deployed"),
        ("canary_verify", "metric_threshold_ok"),
        ("apply", "applied"),
        ("verify", "verified"),
    ],
    "mig-402": [
        ("preflight", "valid"),
        ("approval", "unapproved"),
        ("canary", "canary_deployed"),
        ("canary_verify", "metric_threshold_ok"),
        ("apply", "applied"),
        ("verify", "verified"),
    ],
    "mig-403": [
        ("preflight", "valid"),
        ("approval", "approved"),
        ("backup", "backed_up"),
        ("canary", "canary_deployed"),
        ("canary_verify", "metric_threshold_ok"),
        ("apply", "applied"),
        ("verify", "verified"),
    ],
    "mig-404": [
        ("preflight", "valid"),
        ("approval", "approved"),
        ("backup", "backed_up"),
        ("canary", "canary_deployed"),
        ("canary_verify", "metric_threshold_ok"),
        ("apply", "applied"),
        ("verify", "failed"),
        ("verify", "failed"),
        ("verify", "verified"),
    ],
    "mig-405": [
        ("preflight", "valid"),
        ("approval", "approved"),
        ("backup", "failed"),
    ],
    "mig-406": [
        ("preflight", "valid"),
        ("approval", "approved"),
        ("backup", "backed_up"),
        ("canary", "failed"),
    ],
    "mig-407": [
        ("preflight", "valid"),
        ("approval", "approved"),
        ("backup", "backed_up"),
        ("canary", "canary_deployed"),
        ("canary_verify", "metric_threshold_breach"),
    ],
    "mig-408": [
        ("preflight", "valid"),
        ("approval", "approved"),
        ("backup", "backed_up"),
        ("maintenance_window", "window_not_in_range"),
    ],
    "mig-409": [
        ("preflight", "valid"),
        ("approval", "unapproved"),
    ],
    "mig-410": [
        ("preflight", "valid"),
        ("approval", "approved"),
        ("backup", "backed_up"),
        ("canary", "canary_deployed"),
        ("canary_verify", "metric_threshold_ok"),
        ("apply", "applied"),
        ("verify", "failed"),
        ("rollback", "rolled_back"),
    ],
    "mig-411": [
        ("preflight", "valid"),
        ("approval", "approved"),
        ("backup", "backed_up"),
        ("canary", "canary_deployed"),
        ("canary_verify", "metric_threshold_ok"),
        ("apply", "applied"),
        ("verify", "verified"),
    ],
    "mig-412": [
        ("preflight", "invalid"),
    ],
}


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("case", choices=tuple(EXPECTED))
    parser.add_argument("trial_workspace", type=Path)
    args = parser.parse_args()
    
    # Navigate to the state directory
    events_path = args.trial_workspace / "rollout" / "work" / "state" / args.case / "events.jsonl"
    
    findings: list[str] = []
    
    if not events_path.is_file():
        findings.append(f"events.jsonl not found at {events_path}")
        print(json.dumps({"pass": False, "case": args.case, "findings": findings}, indent=2))
        return 1
    
    events = [json.loads(line) for line in events_path.read_text(encoding="utf-8").splitlines() if line.strip()]
    observed = [(event.get("action"), event.get("status")) for event in events]
    expected = EXPECTED[args.case]
    
    # Check sequence
    if observed != expected:
        findings.append(f"event sequence mismatch: expected={expected}, observed={observed}")
    
    # Check sequence numbers are contiguous
    sequence_numbers = [event.get("sequence") for event in events]
    if sequence_numbers != list(range(1, len(events) + 1)):
        findings.append(f"event sequence numbers must be contiguous from 1; got {sequence_numbers}")
    
    print(json.dumps({"pass": not findings, "case": args.case, "findings": findings}, indent=2))
    return 1 if findings else 0


if __name__ == "__main__":
    raise SystemExit(main())
