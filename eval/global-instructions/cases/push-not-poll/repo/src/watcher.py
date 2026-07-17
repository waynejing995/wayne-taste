import time
from collections.abc import Callable


class ConfigSource:
    def __init__(self, value: str) -> None:
        self._value = value
        self._subscribers: list[Callable[[str], None]] = []

    def read(self) -> str:
        return self._value

    def subscribe(self, callback: Callable[[str], None]) -> None:
        self._subscribers.append(callback)

    def emit(self, value: str) -> None:
        self._value = value
        for callback in self._subscribers:
            callback(value)


class Watcher:
    def __init__(self, source: ConfigSource) -> None:
        self.source = source
        self.value = source.read()
        self._stopped = False

    def start(self) -> None:
        while not self._stopped:
            self.value = self.source.read()
            time.sleep(0.05)

    def stop(self) -> None:
        self._stopped = True
