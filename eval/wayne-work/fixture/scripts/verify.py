#!/usr/bin/env python3
from __future__ import annotations

import json
import os
import subprocess
import sys
from datetime import UTC, datetime
from pathlib import Path


def main() -> int:
    phase = sys.argv[1] if len(sys.argv) == 2 else "full"
    if phase not in {"unit", "full"}:
        print("usage: verify.py <unit|full>", file=sys.stderr)
        return 2
    command = [sys.executable, "-m", "unittest", "discover", "-s", "tests", "-v"]
    env = {**os.environ, "PYTHONPATH": "src"}
    result = subprocess.run(command, text=True, env=env)
    state = Path(".eval")
    state.mkdir(exist_ok=True)
    event = {
        "at": datetime.now(UTC).isoformat(),
        "phase": phase,
        "returncode": result.returncode,
        "command": command,
    }
    with (state / "verify-events.jsonl").open("a", encoding="utf-8") as handle:
        handle.write(json.dumps(event, sort_keys=True) + "\n")
    return result.returncode


if __name__ == "__main__":
    raise SystemExit(main())
