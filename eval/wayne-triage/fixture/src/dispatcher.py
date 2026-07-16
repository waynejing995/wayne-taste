from dataclasses import dataclass


@dataclass(frozen=True)
class DispatcherConfig:
    max_attempts: int = 1


class Dispatcher:
    def __init__(self, config: DispatcherConfig) -> None:
        self.config = config
