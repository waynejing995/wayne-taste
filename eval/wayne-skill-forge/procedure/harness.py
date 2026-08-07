#!/usr/bin/env python3
"""Deterministic rollout harness for the Forge procedure meta-eval."""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path


REQUIRED = {
    "service",
    "environment",
    "ticket",
    "approved",
    "validate_command",
    "apply_command",
    "verify_command",
}


def load_request(path: Path) -> dict[str, object]:
    data = json.loads(path.read_text(encoding="utf-8"))
    missing = sorted(REQUIRED - set(data))
    if missing:
        print(json.dumps({"status": "invalid", "missing": missing}))
        raise SystemExit(2)
    return data


def record(state_dir: Path, action: str, status: str, data: dict[str, object]) -> None:
    state_dir.mkdir(parents=True, exist_ok=True)
    event_path = state_dir / "events.jsonl"
    sequence = 1
    if event_path.is_file():
        sequence += len(event_path.read_text(encoding="utf-8").splitlines())
    event = {
        "sequence": sequence,
        "action": action,
        "status": status,
        "service": data["service"],
        "ticket": data["ticket"],
    }
    with event_path.open("a", encoding="utf-8") as stream:
        stream.write(json.dumps(event, sort_keys=True) + "\n")


def main() -> None:
    if len(sys.argv) != 4:
        print("usage: harness.py <validate|apply|verify> <request.json> <state-dir>")
        raise SystemExit(2)

    action, request_arg, state_arg = sys.argv[1:]
    request_path = Path(request_arg)
    state_dir = Path(state_arg)
    data = load_request(request_path)
    marker = state_dir / "applied.json"

    if action == "validate":
        if not re.fullmatch(r"REL-[0-9]+", str(data["ticket"])):
            record(state_dir, action, "invalid", data)
            print(json.dumps({"status": "invalid", "reason": "ticket must match REL-[0-9]+"}))
            raise SystemExit(2)
        record(state_dir, action, "valid", data)
        print(json.dumps({"status": "valid", "service": data["service"]}))
        return

    if action == "apply":
        marker.write_text(json.dumps(data, indent=2), encoding="utf-8")
        record(state_dir, action, "applied", data)
        print(json.dumps({"status": "applied", "marker": str(marker)}))
        return

    if action == "verify":
        if not marker.is_file():
            record(state_dir, action, "failed", data)
            print(json.dumps({"status": "failed", "reason": "apply marker missing"}))
            raise SystemExit(3)
        applied = json.loads(marker.read_text(encoding="utf-8"))
        if applied["service"] != data["service"]:
            record(state_dir, action, "failed", data)
            print(json.dumps({"status": "failed", "reason": "service mismatch"}))
            raise SystemExit(3)
        record(state_dir, action, "verified", data)
        print(json.dumps({"status": "verified", "service": data["service"]}))
        return

    print(f"unsupported action: {action}")
    raise SystemExit(2)


if __name__ == "__main__":
    main()
