"""Fixture check adapter: compare the rollout event sequence with check_trace.py."""
from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
case, workspace = sys.argv[1], Path(sys.argv[2])
request = json.loads((HERE / f"cases/{case}.json").read_text(encoding="utf-8"))
events = workspace / "rollout/work" / request["validate_command"].split()[-1] / "events.jsonl"
if not events.is_file():
    print(json.dumps({"pass": False, "findings": ["no events.jsonl: no harness command ran"]}))
    raise SystemExit(1)
done = subprocess.run([sys.executable, str(HERE / "check_trace.py"), case, str(events)], capture_output=True, text=True)
result = json.loads(done.stdout)
print(json.dumps({"pass": result["pass"], "findings": result["findings"]}))
raise SystemExit(0 if result["pass"] else 1)
