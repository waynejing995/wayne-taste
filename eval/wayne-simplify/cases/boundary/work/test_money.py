import unittest

from money import apply_charge, charge_from_text, parse_amount


class ParseTest(unittest.TestCase):
    def test_parse(self):
        self.assertEqual(parse_amount("2.005"), 2.0)

    def test_parse_rejects_zero(self):
        with self.assertRaises(ValueError):
            parse_amount("0")


class ChargeTest(unittest.TestCase):
    def test_charge_from_text(self):
        self.assertEqual(charge_from_text({"balance": 10.0}, "2.5"), {"balance": 7.5})

    def test_apply_charge_rejects_negative_when_called_directly(self):
        with self.assertRaises(ValueError):
            apply_charge({"balance": 10.0}, -5)


if __name__ == "__main__":
    unittest.main()
