import unittest

from export.csv_report import render_csv

ROWS = [
    {"name": "  ann lee ", "amount": "$1,200.505"},
    {"name": "BOB", "amount": " 2 "},
]


class CsvTest(unittest.TestCase):
    def test_header_and_two_decimals(self):
        self.assertEqual(render_csv(ROWS).splitlines()[0], "name,amount")
        self.assertTrue(render_csv(ROWS).endswith("Bob,2.00"))

    def test_normalizes_name_and_amount(self):
        self.assertEqual(render_csv(ROWS).splitlines()[1], "Ann Lee,1200.50")


if __name__ == "__main__":
    unittest.main()
