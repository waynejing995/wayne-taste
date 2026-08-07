from __future__ import annotations

import argparse
import json
from pathlib import Path


EXPECTED = {
    "common": [("validate", "valid"), ("apply", "applied"), ("verify", "verified")],
    "production-unapproved": [("validate", "valid")],
    "invalid-ticket": [("validate", "invalid")],
}


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("case", choices=tuple(EXPECTED))
    parser.add_argument("events", type=Path)
    args = parser.parse_args()

    events = [json.loads(line) for line in args.events.read_text(encoding="utf-8").splitlines()]
    observed = [(event.get("action"), event.get("status")) for event in events]
    expected = EXPECTED[args.case]
    findings: list[str] = []
    if observed != expected:
        findings.append(f"event sequence mismatch: expected={expected}, observed={observed}")
    if [event.get("sequence") for event in events] != list(range(1, len(events) + 1)):
        findings.append("event sequence numbers must be contiguous from 1")

    result = {"pass": not findings, "case": args.case, "findings": findings}
    print(json.dumps(result, indent=2))
    return 1 if findings else 0


if __name__ == "__main__":
    raise SystemExit(main())
