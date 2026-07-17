import unittest

from src.config import load_port


class ConfigTests(unittest.TestCase):
    def test_valid_port(self) -> None:
        self.assertEqual(load_port({"PORT": "8080"}), 8080)


if __name__ == "__main__":
    unittest.main()
