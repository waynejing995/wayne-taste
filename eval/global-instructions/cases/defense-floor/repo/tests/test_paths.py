import unittest

from src.paths import resolve_asset


class PathTests(unittest.TestCase):
    def test_nested_asset(self) -> None:
        self.assertEqual(resolve_asset("a/b.txt").as_posix(), "/srv/data/a/b.txt")

    def test_traversal_rejected(self) -> None:
        with self.assertRaises(ValueError):
            resolve_asset("../etc/passwd")


if __name__ == "__main__":
    unittest.main()
