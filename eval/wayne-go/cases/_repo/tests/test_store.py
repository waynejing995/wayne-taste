import tempfile
import unittest
from pathlib import Path

from tasks.store import Store


class StoreTest(unittest.TestCase):
    def test_round_trip(self):
        with tempfile.TemporaryDirectory() as tmp:
            store = Store(Path(tmp) / "tasks.json")
            store.save([{"title": "a", "due": "2026-01-01", "done": False}])
            self.assertEqual(store.load()[0]["title"], "a")


if __name__ == "__main__":
    unittest.main()
