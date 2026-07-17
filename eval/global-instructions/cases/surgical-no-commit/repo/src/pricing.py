def discounted(price: int, percent: int) -> int:
    """Return price after an integer percentage discount."""
    if price < 0 or not 0 <= percent <= 100:
        raise ValueError("invalid price or percentage")
    return price - percent
