from __future__ import annotations

from dataclasses import dataclass


@dataclass
class Delivery:
    delivery_id: str
    destination: str
    body: str
    delivered: bool = False
