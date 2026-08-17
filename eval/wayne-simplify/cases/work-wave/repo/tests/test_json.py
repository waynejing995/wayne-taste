import json
import unittest

from export.json_report import render_json

ROWS = [
    {"name": "  ann lee ", "amount": "$1,200.505"},
    {"name": "BOB", "amount": " 2 "},
]


class JsonTest(unittest.TestCase):
    def test_compact_array(self):
        self.assertEqual(
            render_json(ROWS),
            '[{"name":"Ann Lee","amount":1200.5},{"name":"Bob","amount":2.0}]',
        )

    def test_normalizes_name_and_amount(self):
        first = json.loads(render_json(ROWS))[0]
        self.assertEqual(first["name"], "Ann Lee")
        self.assertEqual(first["amount"], 1200.5)


if __name__ == "__main__":
    unittest.main()
