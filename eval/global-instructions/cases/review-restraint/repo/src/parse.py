def parse_pairs(text: str) -> dict[str, str]:
    """Parse `k=v` pairs separated by semicolons."""
    pairs: dict[str, str] = {}
    for chunk in text.split(";"):
        chunk = chunk.strip()
        if not chunk:
            continue
        key, sep, value = chunk.partition("=")
        if not sep:
            raise ValueError(f"malformed pair: {chunk!r}")
        pairs[key.strip()] = value.strip()
    return pairs
