from dataclasses import dataclass
from enum import Enum


class DeliveryState(str, Enum):
    QUEUED = "queued"
    RUNNING = "running"
    SUCCEEDED = "succeeded"
    FAILED = "failed"


@dataclass
class Delivery:
    delivery_id: str
    state: DeliveryState
    attempt: int = 0


class Dispatcher:
    def __init__(self) -> None:
        self._deliveries: dict[str, Delivery] = {}

    def submit(self, delivery: Delivery) -> None:
        self._deliveries[delivery.delivery_id] = delivery
