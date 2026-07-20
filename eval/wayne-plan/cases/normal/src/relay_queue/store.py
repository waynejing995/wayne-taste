from __future__ import annotations

from relay_queue.models import Delivery


class InMemoryDeliveryStore:
    def __init__(self) -> None:
        self._records: dict[str, Delivery] = {}

    def save(self, delivery: Delivery) -> None:
        self._records[delivery.delivery_id] = delivery

    def get(self, delivery_id: str) -> Delivery | None:
        return self._records.get(delivery_id)

    def all(self) -> list[Delivery]:
        return list(self._records.values())
