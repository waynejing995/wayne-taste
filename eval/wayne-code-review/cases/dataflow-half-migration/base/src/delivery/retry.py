from delivery.config import DEFAULT_TIMEOUT_MS, TeamConfig


def retry_timeout(config: TeamConfig) -> int:
    """Return the timeout for retry attempts."""
    _ = config
    return DEFAULT_TIMEOUT_MS
