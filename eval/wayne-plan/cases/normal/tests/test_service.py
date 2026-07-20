from relay_queue.cli import format_delivery
from relay_queue.service import DeliveryService
from relay_queue.store import InMemoryDeliveryStore


def test_submit_and_mark_delivered() -> None:
    store = InMemoryDeliveryStore()
    service = DeliveryService(store)

    delivery = service.submit("ops@example.com", "ready")
    result = service.mark_delivered(delivery.delivery_id)

    assert result.delivered is True
    assert delivery.delivery_id in format_delivery(result)
