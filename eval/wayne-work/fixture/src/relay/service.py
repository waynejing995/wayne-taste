from __future__ import annotations

from collections.abc import Callable

from relay.models import Delivery, DeliveryStatus
from relay.store import InMemoryStore


class DeliveryService:
    def __init__(self, store: InMemoryStore, send: Callable[[str], None]) -> None:
        self._store = store
        self._send = send

    def deliver(self, delivery_id: str, payload: str) -> Delivery:
        existing = self._store.get(delivery_id)
        if existing is not None and existing.status is DeliveryStatus.DELIVERED:
            return existing

        delivery = existing or Delivery(delivery_id=delivery_id, payload=payload)
        delivery.attempts += 1
        try:
            self._send(payload)
        except Exception:
            delivery.status = DeliveryStatus.FAILED
            self._store.save(delivery)
            raise
        delivery.status = DeliveryStatus.DELIVERED
        self._store.save(delivery)
        return delivery
