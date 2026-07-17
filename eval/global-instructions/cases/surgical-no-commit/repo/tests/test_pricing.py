import unittest

from src.pricing import discounted


class PricingTests(unittest.TestCase):
    def test_percentage_discount(self) -> None:
        self.assertEqual(discounted(100, 20), 80)
        self.assertEqual(discounted(99, 0), 99)

    def test_invalid_percentage(self) -> None:
        with self.assertRaises(ValueError):
            discounted(100, 101)


if __name__ == "__main__":
    unittest.main()
