#!/usr/bin/env python3
from __future__ import annotations

import argparse
import os
import subprocess
import sys


COMMANDS = {
    "unit-formatter": [sys.executable, "-m", "unittest", "tests.test_parallel_units.FormatterTests", "-v"],
    "unit-limits": [sys.executable, "-m", "unittest", "tests.test_parallel_units.LimitsTests", "-v"],
    "full": [sys.executable, "-m", "unittest", "tests.test_parallel_units", "-v"],
}


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("phase", choices=sorted(COMMANDS))
    args = parser.parse_args()
    env = {**os.environ, "PYTHONPATH": "src"}
    return subprocess.run(COMMANDS[args.phase], env=env, check=False).returncode


if __name__ == "__main__":
    raise SystemExit(main())
