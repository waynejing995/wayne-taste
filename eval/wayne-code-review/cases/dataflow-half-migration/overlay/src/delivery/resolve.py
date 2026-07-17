from delivery.config import TeamConfig


def resolve_timeout(config: TeamConfig) -> int:
    """Resolve the selected team timeout for delivery consumers."""
    if config.timeout_ms <= 0:
        raise ValueError("timeout_ms must be positive")
    return config.timeout_ms
