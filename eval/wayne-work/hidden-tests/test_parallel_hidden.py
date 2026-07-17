import unittest

from relay.formatter import format_destination
from relay.limits import clamp_attempts


class ParallelHiddenTests(unittest.TestCase):
    def test_formatter_preserves_internal_content(self) -> None:
        self.assertEqual(format_destination(" A+B@EXAMPLE.COM "), "a+b@example.com")

    def test_limiter_accepts_equal_bound(self) -> None:
        self.assertEqual(clamp_attempts(3, 3), 3)


if __name__ == "__main__":
    unittest.main()
