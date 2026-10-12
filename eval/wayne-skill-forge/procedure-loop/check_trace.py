from __future__ import annotations

import argparse
import json
from pathlib import Path

V, A, R = ("validate", "valid"), ("apply", "applied"), ("repair", "repaired")
FAIL, OK = ("verify", "failed"), ("verify", "verified")
EXPECTED = {
    "healthy": [V, A, OK],
    "recovers": [V, A, FAIL, R, OK],
    "exhausted": [V, A, FAIL, R, FAIL, R, FAIL],
    "unrecoverable": [V, A, FAIL],
}


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("case", choices=tuple(EXPECTED))
    parser.add_argument("events", type=Path)
    args = parser.parse_args()
    events = [json.loads(line) for line in args.events.read_text(encoding="utf-8").splitlines()]
    observed = [(event.get("action"), event.get("status")) for event in events]
    findings: list[str] = []
    if observed != EXPECTED[args.case]:
        findings.append(f"event sequence mismatch: expected={EXPECTED[args.case]}, observed={observed}")
    if [event.get("sequence") for event in events] != list(range(1, len(events) + 1)):
        findings.append("event sequence numbers must be contiguous from 1")
    print(json.dumps({"pass": not findings, "case": args.case, "findings": findings}, indent=2))
    return 1 if findings else 0


if __name__ == "__main__":
    raise SystemExit(main())
