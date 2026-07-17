#!/usr/bin/env python3
"""Calibrate every independent dispatch report invariant."""

from __future__ import annotations

import copy

from check_dispatch import validate_report


def valid() -> dict[str, object]:
    return {
        "failure": {
            "dispatch_failed": True,
            "no_job_id": True,
            "log_preserved": True,
            "reason_preserved": True,
        },
        "resume": {
            "dispatch_started": True,
            "blocked_observed": True,
            "alive_while_blocked": True,
            "resume_succeeded": True,
            "same_thread_active": True,
            "completed": True,
            "one_job": True,
        },
    }


def main() -> int:
    positive = valid()
    if validate_report(positive):
        raise AssertionError("valid dispatch report failed")
    count = 0
    for section in ("failure", "resume"):
        rows = positive[section]
        assert isinstance(rows, dict)
        for key in rows:
            count += 1
            mutation = copy.deepcopy(positive)
            mutated_rows = mutation[section]
            assert isinstance(mutated_rows, dict)
            mutated_rows[key] = False
            findings = validate_report(mutation)
            if not findings:
                raise AssertionError(f"mutation escaped: {section}.{key}")
    print(f"PASS: 1 positive and {count} independent dispatch mutations")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
