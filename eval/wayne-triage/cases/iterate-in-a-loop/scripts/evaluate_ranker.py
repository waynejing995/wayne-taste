from src.ranker import rank

EXPECTED = {
    95: "critical",
    90: "critical",
    80: "high",
    75: "high",
    60: "medium",
    50: "medium",
    20: "low",
}

failures = [
    f"score={score}: expected={expected}, actual={rank(score)}"
    for score, expected in EXPECTED.items()
    if rank(score) != expected
]
if failures:
    raise SystemExit("\n".join(failures))
