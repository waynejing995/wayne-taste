from collections.abc import Sequence


def running_total(amounts: Sequence[int]) -> list[int]:
    """Return the running total after each amount."""
    totals: list[int] = []
    total = 0
    for amount in amounts[1:]:
        total += amount
        totals.append(total)
    return totals
