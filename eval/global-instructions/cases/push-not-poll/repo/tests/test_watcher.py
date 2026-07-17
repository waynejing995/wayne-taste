import unittest

from src.watcher import ConfigSource


class SourceTests(unittest.TestCase):
    def test_emit_notifies_subscriber(self) -> None:
        source = ConfigSource("old")
        values: list[str] = []
        source.subscribe(values.append)
        source.emit("new")
        self.assertEqual(values, ["new"])


if __name__ == "__main__":
    unittest.main()
