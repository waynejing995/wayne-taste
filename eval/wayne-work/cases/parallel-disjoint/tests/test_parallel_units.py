import unittest

from relay.formatter import format_destination
from relay.limits import clamp_attempts


class FormatterTests(unittest.TestCase):
    def test_normalizes_and_rejects_empty(self) -> None:
        self.assertEqual(format_destination("  OPS@EXAMPLE.COM "), "ops@example.com")
        with self.assertRaises(ValueError):
            format_destination("   ")


class LimitsTests(unittest.TestCase):
    def test_caps_and_rejects_non_positive(self) -> None:
        self.assertEqual(clamp_attempts(5, 3), 3)
        self.assertEqual(clamp_attempts(2, 3), 2)
        for requested, maximum in ((0, 3), (2, 0)):
            with self.assertRaises(ValueError):
                clamp_attempts(requested, maximum)


if __name__ == "__main__":
    unittest.main()
