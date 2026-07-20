from __future__ import annotations

import hashlib
import json
from datetime import UTC, datetime, timedelta

import pytest

import relay_queue.service as service_module
from relay_queue.cli import format_delivery
from relay_queue.errors import IdempotencyConflict, PermanentDeliveryError, TransientDeliveryError
from relay_queue.models import DeliveryRequest
from relay_queue.service import DeliveryService
from relay_queue.store import InMemoryDeliveryStore


def state_value(delivery: object) -> str:
    state = getattr(delivery, "state")
    return getattr(state, "value", state)


def request(request_id: str = "req-101", body: str = "deploy ready") -> DeliveryRequest:
    return DeliveryRequest(request_id=request_id, destination="ops@example.com", body=body)


def test_submit_is_idempotent_and_uses_stable_identity() -> None:
    store = InMemoryDeliveryStore()
    service = DeliveryService(store)

    first = service.submit(request())
    second = service.submit(request())

    expected = hashlib.sha256(b"req-101").hexdigest()[:12]
    assert first.created is True
    assert second.created is False
    assert first.delivery.delivery_id == expected
    assert second.delivery.delivery_id == expected
    assert len(store.all()) == 1
    assert store.get_by_request_id("req-101").delivery_id == first.delivery.delivery_id

    replacement_service = DeliveryService(store)
    resumed = replacement_service.submit(request())
    assert resumed.created is False
    assert resumed.delivery.delivery_id == expected
    assert len(store.all()) == 1


@pytest.mark.parametrize("field", ["request_id", "destination", "body"])
def test_blank_input_fails_before_mutation(field: str) -> None:
    store = InMemoryDeliveryStore()
    service = DeliveryService(store)
    values = {"request_id": "req-valid", "destination": "ops@example.com", "body": "ready"}
    values[field] = " "

    with pytest.raises(ValueError):
        service.submit(DeliveryRequest(**values))

    assert store.all() == []


def test_conflicting_body_or_destination_fails_without_mutation() -> None:
    store = InMemoryDeliveryStore()
    service = DeliveryService(store)
    service.submit(request())

    with pytest.raises(IdempotencyConflict):
        service.submit(request(body="different"))
    with pytest.raises(IdempotencyConflict):
        service.submit(DeliveryRequest(request_id="req-101", destination="other@example.com", body="deploy ready"))

    assert len(store.all()) == 1


def test_transient_failures_wait_until_due_then_succeed() -> None:
    store = InMemoryDeliveryStore()
    service = DeliveryService(store)
    delivery = service.submit(request()).delivery
    now = datetime(2026, 7, 15, tzinfo=UTC)
    calls = 0

    def sender(_delivery: object) -> None:
        nonlocal calls
        calls += 1
        assert getattr(_delivery, "attempts") == calls
        if calls < 3:
            raise TransientDeliveryError(f"temporary-{calls}")

    processed = service.dispatch_due(now, sender)
    assert processed == [delivery]
    assert delivery.attempts == 1
    assert state_value(delivery) == "retry_wait"
    assert delivery.retry_at == now + timedelta(seconds=30)

    assert service.dispatch_due(now + timedelta(seconds=29), sender) == []
    service.dispatch_due(now + timedelta(seconds=30), sender)
    assert delivery.attempts == 2
    assert delivery.retry_at == now + timedelta(seconds=90)

    service.dispatch_due(now + timedelta(seconds=90), sender)
    assert delivery.attempts == 3
    assert state_value(delivery) == "delivered"
    assert delivery.retry_at is None
    delivered_payload = json.loads(format_delivery(delivery))
    assert delivered_payload["state"] == "delivered"
    assert delivered_payload["delivered"] is True


def test_third_transient_failure_is_terminal() -> None:
    store = InMemoryDeliveryStore()
    service = DeliveryService(store)
    delivery = service.submit(request("req-max")).delivery
    now = datetime(2026, 7, 15, tzinfo=UTC)

    def sender(_delivery: object) -> None:
        raise TransientDeliveryError("still unavailable")

    service.dispatch_due(now, sender)
    service.dispatch_due(now + timedelta(seconds=30), sender)
    service.dispatch_due(now + timedelta(seconds=90), sender)

    assert delivery.attempts == 3
    assert state_value(delivery) == "failed"
    assert delivery.retry_at is None
    assert store.list_due(now + timedelta(days=1)) == []


def test_permanent_failure_is_terminal_after_one_attempt() -> None:
    store = InMemoryDeliveryStore()
    service = DeliveryService(store)
    delivery = service.submit(request("req-permanent")).delivery
    now = datetime(2026, 7, 15, tzinfo=UTC)

    def sender(_delivery: object) -> None:
        raise PermanentDeliveryError("bad destination")

    service.dispatch_due(now, sender)

    assert delivery.attempts == 1
    assert state_value(delivery) == "failed"
    assert delivery.last_error == "bad destination"
    assert store.list_due(now + timedelta(days=1)) == []


def test_formatter_exposes_retry_state_without_mutation() -> None:
    store = InMemoryDeliveryStore()
    service = DeliveryService(store)
    delivery = service.submit(request("req-format")).delivery
    now = datetime(2026, 7, 15, tzinfo=UTC)

    def sender(_delivery: object) -> None:
        raise TransientDeliveryError("temporary")

    service.dispatch_due(now, sender)
    before = (delivery.state, delivery.attempts, delivery.retry_at, delivery.last_error)
    payload = json.loads(format_delivery(delivery))

    assert payload["request_id"] == "req-format"
    assert payload["delivery_id"] == delivery.delivery_id
    assert payload["state"] == "retry_wait"
    assert payload["destination"] == "ops@example.com"
    assert payload["delivered"] is False
    assert payload["attempts"] == 1
    assert payload["retry_at"]
    assert payload["last_error"] == "temporary"
    assert (delivery.state, delivery.attempts, delivery.retry_at, delivery.last_error) == before


def test_obsolete_mutation_and_delay_apis_are_removed() -> None:
    assert not hasattr(DeliveryService, "mark_delivered")
    assert not hasattr(service_module, "legacy_retry_delay")
