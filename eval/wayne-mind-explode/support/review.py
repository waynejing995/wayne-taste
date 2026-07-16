#!/usr/bin/env python3
"""Deterministic provider-neutral review voices for the design eval."""

from __future__ import annotations

import hashlib
import json
import sys
from pathlib import Path


ROLES = {
    "product": (
        "Assumption Challenge",
        "Challenge the necessity, scope, non-goals, and user-visible value.",
    ),
    "engineering": (
        "Operational Readiness",
        "Resolve ownership, failure behavior, concurrency, observability, and rollback.",
    ),
}


def main() -> int:
    if len(sys.argv) != 3 or sys.argv[1] not in ROLES:
        print("usage: review.py <product|engineering> <spec-path>", file=sys.stderr)
        return 2

    role = sys.argv[1]
    spec = Path(sys.argv[2]).resolve()
    if not spec.is_file():
        print(f"missing spec: {spec}", file=sys.stderr)
        return 2

    repo = Path.cwd().resolve()
    try:
        relative_spec = spec.relative_to(repo).as_posix()
    except ValueError:
        print("spec must be inside the current repository", file=sys.stderr)
        return 2

    state = repo / ".eval"
    state.mkdir(exist_ok=True)
    counter = state / f"{role}-count"
    count = int(counter.read_text(encoding="utf-8")) + 1 if counter.exists() else 1
    counter.write_text(str(count), encoding="utf-8")

    heading, focus = ROLES[role]
    text = spec.read_text(encoding="utf-8")
    if count == 1 or f"## {heading}" not in text:
        verdict = "REVISE"
        detail = f"Add `## {heading}` and resolve this voice: {focus}"
    else:
        verdict = "PASS"
        detail = f"{role} voice is satisfied after an independent reread."

    event = {
        "role": role,
        "attempt": count,
        "verdict": verdict,
        "spec": relative_spec,
        "sha256": hashlib.sha256(spec.read_bytes()).hexdigest(),
    }
    with (state / "review-events.jsonl").open("a", encoding="utf-8") as handle:
        handle.write(json.dumps(event, sort_keys=True) + "\n")

    print(f"# {role.title()} Review")
    print()
    print(f"VERDICT: {verdict}")
    print(f"SPEC: {relative_spec}")
    print(f"FOCUS: {focus}")
    print(f"DETAIL: {detail}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
