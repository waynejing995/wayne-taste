def remove_suffix(value: str, suffix: str) -> str:
    """Remove suffix when present, otherwise preserve the value."""
    if suffix and value.endswith(suffix):
        return value[: -len(suffix)]
    return value[:-1]
