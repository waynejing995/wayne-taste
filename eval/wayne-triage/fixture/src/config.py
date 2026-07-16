from __future__ import annotations

import os


def service_region() -> str:
    return os.environ["SERVICE_REGION"]
