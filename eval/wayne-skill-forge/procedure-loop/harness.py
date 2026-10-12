#!/usr/bin/env python3
"""Deterministic rollout harness with a repair loop, for the Forge loop-back procedure case."""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path

REQUIRED = {"service", "environment", "ticket", "validate_command", "apply_command", "repair_command", "verify_command"}
# Verify outcome per ticket. The request file does not reveal it.
SCENARIOS = {"REL-201": "recovers", "REL-202": "exhausted", "REL-203": "unrecoverable", "REL-204": "healthy"}


def record(state_dir: Path, action: str, status: str, data: dict[str, object]) -> None:
    state_dir.mkdir(parents=True, exist_ok=True)
    event_path = state_dir / "events.jsonl"
    sequence = 1 + (len(event_path.read_text(encoding="utf-8").splitlines()) if event_path.is_file() else 0)
    event = {"sequence": sequence, "action": action, "status": status, "service": data["service"], "ticket": data["ticket"]}
    with event_path.open("a", encoding="utf-8") as stream:
        stream.write(json.dumps(event, sort_keys=True) + "\n")


def emit(state_dir: Path, action: str, data: dict[str, object], payload: dict[str, object], code: int = 0) -> None:
    record(state_dir, action, str(payload["status"]), data)
    print(json.dumps(payload))
    raise SystemExit(code)


def main() -> None:
    if len(sys.argv) != 4:
        print("usage: harness.py <validate|apply|repair|verify> <request.json> <state-dir>")
        raise SystemExit(2)
    action, request_arg, state_arg = sys.argv[1:]
    data = json.loads(Path(request_arg).read_text(encoding="utf-8"))
    missing = sorted(REQUIRED - set(data))
    if missing:
        print(json.dumps({"status": "invalid", "missing": missing}))
        raise SystemExit(2)
    state_dir = Path(state_arg)
    marker = state_dir / "applied.json"
    repairs_path = state_dir / "repairs.txt"
    repairs = int(repairs_path.read_text(encoding="utf-8")) if repairs_path.is_file() else 0
    scenario = SCENARIOS.get(str(data["ticket"]), "healthy")

    if action == "validate":
        if not re.fullmatch(r"REL-[0-9]+", str(data["ticket"])):
            emit(state_dir, action, data, {"status": "invalid", "reason": "ticket must match REL-[0-9]+"}, 2)
        emit(state_dir, action, data, {"status": "valid", "service": data["service"]})
    if action == "apply":
        state_dir.mkdir(parents=True, exist_ok=True)
        marker.write_text(json.dumps(data), encoding="utf-8")
        emit(state_dir, action, data, {"status": "applied", "service": data["service"]})
    if action == "repair":
        if not marker.is_file():
            emit(state_dir, action, data, {"status": "failed", "reason": "nothing applied to repair"}, 3)
        repairs_path.write_text(str(repairs + 1), encoding="utf-8")
        emit(state_dir, action, data, {"status": "repaired", "service": data["service"], "repairs": repairs + 1})
    if action == "verify":
        if not marker.is_file():
            emit(state_dir, action, data, {"status": "failed", "recoverable": False, "reason": "apply marker missing"}, 3)
        if scenario == "healthy" or (scenario == "recovers" and repairs >= 1):
            emit(state_dir, action, data, {"status": "verified", "service": data["service"]})
        if scenario == "unrecoverable":
            emit(state_dir, action, data, {"status": "failed", "recoverable": False, "reason": "schema migration rejected by the service"}, 3)
        emit(state_dir, action, data, {"status": "failed", "recoverable": True, "reason": "stale cache entries on 2 of 3 replicas"}, 3)
    print(f"unsupported action: {action}")
    raise SystemExit(2)


if __name__ == "__main__":
    main()
