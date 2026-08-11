#!/usr/bin/env python3
"""Deterministic provider-neutral review voices for the design eval.

Each voice demands something the spec contract already requires, never a section
named after the review itself: review notes must not survive in the spec.
"""

from __future__ import annotations

import hashlib
import json
import re
import sys
from pathlib import Path


REQUIREMENT = re.compile(r"^###\s+R[1-9]\d*\b", re.MULTILINE)
DECISION = re.compile(r"^###\s+D[1-9]\d*\b", re.MULTILINE)


def blocks(text: str, pattern: re.Pattern[str]) -> list[str]:
    """Each entry ends at the next peer heading or the next H2, never at EOF.

    Running the last entry to the end of the file would let an unrelated later
    `**Acceptance**` satisfy a requirement that never carried one.
    """
    stops = sorted(
        {match.start() for match in pattern.finditer(text)}
        | {match.start() for match in re.finditer(r"^## ", text, re.MULTILINE)}
        | {len(text)}
    )
    found = []
    for start in (match.start() for match in pattern.finditer(text)):
        end = next(stop for stop in stops if stop > start)
        found.append(text[start:end])
    return found


def product_gap(text: str) -> str | None:
    if "## Non-goals" not in text:
        return "state the non-goals: what this deliberately does not do"
    found = blocks(text, REQUIREMENT)
    if not found:
        return "number the approved behavior as R<n> requirements"
    for field in ("**Current**", "**Target**", "**Acceptance**"):
        if any(field not in block for block in found):
            label = field.strip("*")
            return f"give every R<n> requirement its {label}"
    return None


def engineering_gap(text: str) -> str | None:
    if "## Rollback" not in text:
        return "state how this is undone and what becomes unrecoverable"
    found = blocks(text, DECISION)
    if not found:
        return "carry the justifying decisions as D<n> entries"
    if any("**Consequences**" not in block for block in found):
        return "give every D<n> decision the cost it accepts under Consequences"
    return None


ROLES = {
    "product": (
        "Challenge the necessity, scope, non-goals, and user-visible value.",
        product_gap,
    ),
    "engineering": (
        "Resolve ownership, failure behavior, concurrency, observability, and rollback.",
        engineering_gap,
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

    focus, detect = ROLES[role]
    text = spec.read_text(encoding="utf-8")
    gap = detect(text)
    if gap is not None:
        verdict = "REVISE"
        detail = f"Resolve this in the spec itself: {gap}."
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
