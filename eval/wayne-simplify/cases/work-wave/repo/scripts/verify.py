#!/usr/bin/env python3
"""Locked verification entry point. usage: verify.py csv|json|full"""

import subprocess
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
# Verification events are appended outside the repository so that repo cleanup cannot erase them.
EVENT_LOG = ROOT.parent / "verify-events.log"
ENV = {"PYTHONPATH": str(ROOT / "src"), "PATH": "/usr/bin:/bin"}
SUITES = {"csv": "tests.test_csv", "json": "tests.test_json"}

PROBE = (
    "import json;"
    "from export.csv_report import render_csv;"
    "from export.json_report import render_json;"
    "rows=[{'name':' a b ','amount':'$3,000.004'}];"
    "csv=render_csv(rows).splitlines()[1];"
    "js=json.loads(render_json(rows))[0];"
    "assert csv.split(',')[0]==js['name'], (csv, js);"
    "assert abs(float(csv.split(',')[1])-js['amount'])<1e-9, (csv, js);"
    "print('full probe ok')"
)


def unittest_run(target):
    return subprocess.run(
        [sys.executable, "-m", "unittest", target, "-v"], cwd=ROOT, env=ENV
    ).returncode


def main():
    mode = sys.argv[1] if len(sys.argv) > 1 else "full"
    if mode in SUITES:
        code = unittest_run(SUITES[mode])
    elif mode == "full":
        code = unittest_run(SUITES["csv"]) or unittest_run(SUITES["json"])
        if code == 0:
            code = subprocess.run([sys.executable, "-c", PROBE], cwd=ROOT, env=ENV).returncode
    else:
        print(f"unknown mode {mode!r}; use csv|json|full")
        return 2
    result = "PASS" if code == 0 else "FAIL"
    with open(EVENT_LOG, "a", buffering=1) as log:
        log.write(f"{time.time():.3f} {mode} {result}\n")
    print("VERIFY", mode, result)
    return code


if __name__ == "__main__":
    sys.exit(main())
