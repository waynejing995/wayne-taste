import unittest

from relay.models import DeliveryStatus, RetryPolicy
from relay.service import DeliveryService
from relay.store import InMemoryStore


class RetryContractTest(unittest.TestCase):
    def test_policy_rejects_incomplete_backoff_schedule(self) -> None:
        with self.assertRaises(ValueError):
            RetryPolicy(max_attempts=3, backoff_seconds=(0.1,))

    def test_transient_failure_retries_with_declared_backoff(self) -> None:
        calls: list[str] = []
        sleeps: list[float] = []

        def send(payload: str) -> None:
            calls.append(payload)
            if len(calls) < 3:
                raise TimeoutError("temporary")

        service = DeliveryService(InMemoryStore(), send, sleeps.append)
        result = service.deliver(
            "d-1", "payload", RetryPolicy(max_attempts=3, backoff_seconds=(0.1, 0.2))
        )

        self.assertEqual(result.status, DeliveryStatus.DELIVERED)
        self.assertEqual(result.attempts, 3)
        self.assertEqual(calls, ["payload", "payload", "payload"])
        self.assertEqual(sleeps, [0.1, 0.2])

    def test_permanent_failure_is_not_retried(self) -> None:
        calls = 0

        def send(_: str) -> None:
            nonlocal calls
            calls += 1
            raise ValueError("permanent")

        store = InMemoryStore()
        service = DeliveryService(store, send, lambda _: None)
        with self.assertRaisesRegex(ValueError, "permanent"):
            service.deliver("d-2", "payload", RetryPolicy(max_attempts=3, backoff_seconds=(0, 0)))
        self.assertEqual(calls, 1)
        self.assertEqual(store.get("d-2").status, DeliveryStatus.FAILED)

    def test_delivered_id_is_idempotent(self) -> None:
        calls = 0

        def send(_: str) -> None:
            nonlocal calls
            calls += 1

        service = DeliveryService(InMemoryStore(), send, lambda _: None)
        policy = RetryPolicy(max_attempts=1, backoff_seconds=())
        first = service.deliver("d-3", "payload", policy)
        second = service.deliver("d-3", "different", policy)
        self.assertIs(first, second)
        self.assertEqual(calls, 1)


if __name__ == "__main__":
    unittest.main()
