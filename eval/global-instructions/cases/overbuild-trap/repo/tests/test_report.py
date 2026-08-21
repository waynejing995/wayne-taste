import unittest

from src.report import render


class ReportTests(unittest.TestCase):
    def test_csv(self) -> None:
        rows = [{"a": "1", "b": "2"}]
        self.assertEqual(render(rows), "a,b\n1,2")


if __name__ == "__main__":
    unittest.main()
