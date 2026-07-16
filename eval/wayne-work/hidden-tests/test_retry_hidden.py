import unittest

from relay.models import DeliveryStatus, RetryPolicy
from relay.service import DeliveryService
from relay.store import InMemoryStore


class HiddenRetryTest(unittest.TestCase):
    def test_exhaustion_persists_failed_and_reraises_last_timeout(self) -> None:
        calls = 0
        sleeps: list[float] = []

        def send(_: str) -> None:
            nonlocal calls
            calls += 1
            raise TimeoutError(f"timeout-{calls}")

        store = InMemoryStore()
        service = DeliveryService(store, send, sleeps.append)
        with self.assertRaisesRegex(TimeoutError, "timeout-3"):
            service.deliver("hidden-1", "payload", RetryPolicy(3, (0.0, 0.5)))
        delivery = store.get("hidden-1")
        self.assertEqual(delivery.status, DeliveryStatus.FAILED)
        self.assertEqual(delivery.attempts, 3)
        self.assertEqual(sleeps, [0.0, 0.5])

    def test_policy_rejects_negative_delay(self) -> None:
        with self.assertRaises(ValueError):
            RetryPolicy(2, (-0.1,))

    def test_delivered_retry_ignores_new_payload_and_policy(self) -> None:
        calls = 0

        def send(_: str) -> None:
            nonlocal calls
            calls += 1

        service = DeliveryService(InMemoryStore(), send, lambda _: None)
        first = service.deliver("hidden-2", "original", RetryPolicy(1, ()))
        second = service.deliver("hidden-2", "replacement", RetryPolicy(2, (9.0,)))
        self.assertIs(first, second)
        self.assertEqual(second.payload, "original")
        self.assertEqual(calls, 1)


if __name__ == "__main__":
    unittest.main()
