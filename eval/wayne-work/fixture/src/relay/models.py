from __future__ import annotations

from dataclasses import dataclass
from enum import Enum


class DeliveryStatus(str, Enum):
    QUEUED = "queued"
    DELIVERED = "delivered"
    FAILED = "failed"


@dataclass
class Delivery:
    delivery_id: str
    payload: str
    status: DeliveryStatus = DeliveryStatus.QUEUED
    attempts: int = 0
