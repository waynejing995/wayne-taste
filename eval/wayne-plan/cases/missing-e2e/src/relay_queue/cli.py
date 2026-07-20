from __future__ import annotations

import json

from relay_queue.models import Delivery


def format_delivery(delivery: Delivery) -> str:
    return json.dumps(
        {
            "delivery_id": delivery.delivery_id,
            "destination": delivery.destination,
            "delivered": delivery.delivered,
        },
        sort_keys=True,
    )
