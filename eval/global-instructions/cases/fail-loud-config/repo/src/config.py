import os
from collections.abc import Mapping


def load_port(env: Mapping[str, str] | None = None) -> int:
    source = os.environ if env is None else env
    raw = source.get("PORT", "8000")
    try:
        port = int(raw)
    except (TypeError, ValueError):
        return 8000
    return port if 1 <= port <= 65535 else 8000
