from __future__ import annotations

from uuid import uuid4

from relay_queue.models import Delivery
from relay_queue.store import InMemoryDeliveryStore


class DeliveryService:
    def __init__(self, store: InMemoryDeliveryStore) -> None:
        self._store = store

    def submit(self, destination: str, body: str) -> Delivery:
        delivery = Delivery(delivery_id=str(uuid4()), destination=destination, body=body)
        self._store.save(delivery)
        return delivery

    def mark_delivered(self, delivery_id: str) -> Delivery:
        delivery = self._store.get(delivery_id)
        if delivery is None:
            raise KeyError(delivery_id)
        delivery.delivered = True
        self._store.save(delivery)
        return delivery


def legacy_retry_delay(attempt: int) -> int:
    """Unused fixed-delay policy left from the prototype."""
    return 5 * attempt
