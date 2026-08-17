import unittest

from money import parse_amount


class ParseTest(unittest.TestCase):
    def test_parse(self):
        self.assertEqual(parse_amount("2.005"), 2.0)


if __name__ == "__main__":
    unittest.main()
