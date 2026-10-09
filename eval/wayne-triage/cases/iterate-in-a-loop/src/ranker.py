from __future__ import annotations

from src.rank_policy import BANDS


def rank(score: int) -> str:
    for threshold, label in BANDS:
        if score > threshold:
            return label
    return "low"
