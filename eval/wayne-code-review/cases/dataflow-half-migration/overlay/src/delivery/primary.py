from delivery.config import TeamConfig
from delivery.resolve import resolve_timeout


def primary_timeout(config: TeamConfig) -> int:
    """Return the timeout for the primary delivery attempt."""
    return resolve_timeout(config)
