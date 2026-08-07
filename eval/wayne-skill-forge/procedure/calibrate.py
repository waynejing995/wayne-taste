from __future__ import annotations

import json
import subprocess
import sys
import tempfile
from pathlib import Path


ROOT = Path(__file__).resolve().parent
HARNESS = ROOT / "harness.py"
CHECKER = ROOT / "check_trace.py"
CASES = ROOT / "cases"


def run(action: str, case: str, state: Path) -> None:
    subprocess.run(
        [sys.executable, str(HARNESS), action, str(CASES / f"{case}.json"), str(state)],
        check=False,
        capture_output=True,
        text=True,
    )


def check(case: str, state: Path) -> bool:
    completed = subprocess.run(
        [sys.executable, str(CHECKER), case, str(state / "events.jsonl")],
        check=False,
        capture_output=True,
        text=True,
    )
    return bool(json.loads(completed.stdout)["pass"])


def main() -> int:
    failures: list[str] = []
    print("| Case | Expected | Observed |")
    print("|---|---|---|")
    with tempfile.TemporaryDirectory(prefix="forge-procedure-calibration-") as temp:
        root = Path(temp)
        valid_sequences = {
            "common": ("validate", "apply", "verify"),
            "production-unapproved": ("validate",),
            "invalid-ticket": ("validate",),
        }
        for case, actions in valid_sequences.items():
            state = root / f"valid-{case}"
            for action in actions:
                run(action, case, state)
            observed = check(case, state)
            print(f"| valid {case} | pass | {'pass' if observed else 'fail'} |")
            if not observed:
                failures.append(f"valid {case}")

        invalid_sequences = {
            "common": ("validate", "apply", "apply", "verify"),
            "production-unapproved": ("validate", "apply"),
            "invalid-ticket": ("validate", "apply"),
        }
        for case, actions in invalid_sequences.items():
            state = root / f"invalid-{case}"
            for action in actions:
                run(action, case, state)
            observed = check(case, state)
            print(f"| invalid {case} | fail | {'pass' if observed else 'fail'} |")
            if observed:
                failures.append(f"invalid {case}")

    if failures:
        print(f"calibration failures: {failures}")
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
