from __future__ import annotations

from relay.models import Delivery


class InMemoryStore:
    def __init__(self) -> None:
        self._deliveries: dict[str, Delivery] = {}

    def get(self, delivery_id: str) -> Delivery | None:
        return self._deliveries.get(delivery_id)

    def save(self, delivery: Delivery) -> None:
        self._deliveries[delivery.delivery_id] = delivery
