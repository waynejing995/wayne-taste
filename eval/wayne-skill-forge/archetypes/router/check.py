"""Fixture check adapter for check_output.py."""
from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
case, workspace = sys.argv[1], Path(sys.argv[2])
done = subprocess.run([sys.executable, str(HERE / "check_output.py"), str(workspace / "answer.md"), "--expected", {"no-match": "NO_MATCH", "multiple-signals": "NO_MATCH"}.get(case, case)], capture_output=True, text=True)
result = json.loads(done.stdout)
print(json.dumps({"pass": result["pass"], "findings": result["findings"]}))
raise SystemExit(0 if result["pass"] else 1)
