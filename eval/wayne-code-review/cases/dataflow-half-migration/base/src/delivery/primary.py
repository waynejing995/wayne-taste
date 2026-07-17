from delivery.config import DEFAULT_TIMEOUT_MS, TeamConfig


def primary_timeout(config: TeamConfig) -> int:
    """Return the timeout for the primary delivery attempt."""
    _ = config
    return DEFAULT_TIMEOUT_MS
