from __future__ import annotations

import json
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent


def trace(case: str, actions: tuple[str, ...], root: Path, label: str) -> bool:
    state = root / f"{label}-{case}"
    for action in actions:
        subprocess.run([sys.executable, str(ROOT / "harness.py"), action, str(ROOT / f"cases/{case}.json"), str(state)], capture_output=True, check=False)
    done = subprocess.run([sys.executable, str(ROOT / "check_trace.py"), case, str(state / "events.jsonl")], capture_output=True, text=True, check=False)
    return bool(json.loads(done.stdout)["pass"])


def main() -> int:
    valid = {
        "healthy": ("validate", "apply", "verify"),
        "recovers": ("validate", "apply", "verify", "repair", "verify"),
        "exhausted": ("validate", "apply", "verify", "repair", "verify", "repair", "verify"),
        "unrecoverable": ("validate", "apply", "verify"),
    }
    invalid = {
        "recovers-no-reverify": ("recovers", ("validate", "apply", "verify", "repair")),
        "recovers-reapply": ("recovers", ("validate", "apply", "verify", "apply", "verify")),
        "exhausted-third-repair": ("exhausted", ("validate", "apply", "verify", "repair", "verify", "repair", "verify", "repair", "verify")),
        "exhausted-stops-early": ("exhausted", ("validate", "apply", "verify", "repair", "verify")),
        "unrecoverable-repairs": ("unrecoverable", ("validate", "apply", "verify", "repair", "verify")),
        "healthy-extra-repair": ("healthy", ("validate", "apply", "verify", "repair", "verify")),
    }
    failures: list[str] = []
    print("| Case | Expected | Observed |")
    print("|---|---|---|")
    with tempfile.TemporaryDirectory(prefix="forge-loop-calibration-") as temp:
        root = Path(temp)
        for case, actions in valid.items():
            ok = trace(case, actions, root, "valid")
            print(f"| valid {case} | pass | {'pass' if ok else 'fail'} |")
            if not ok:
                failures.append(f"valid {case}")
        for label, (case, actions) in invalid.items():
            ok = trace(case, actions, root, label)
            print(f"| {label} | fail | {'pass' if ok else 'fail'} |")
            if ok:
                failures.append(label)
    if failures:
        print(f"calibration failures: {failures}")
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
