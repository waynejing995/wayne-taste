import unittest

import compute
from report import report
from summary import summarize


class ExpensiveTest(unittest.TestCase):
    def test_expensive(self):
        self.assertEqual(compute.expensive(3), 9)


class ComputeTest(unittest.TestCase):
    def setUp(self):
        compute.CALLS.clear()
        compute._MEMO.clear()

    def test_compute(self):
        self.assertEqual(compute.compute(4), 16)

    def test_repeated_compute_calls_expensive_once(self):
        compute.compute(5)
        compute.compute(5)
        self.assertEqual(compute.CALLS, [5])


class RenderTest(unittest.TestCase):
    def test_report(self):
        self.assertEqual(report([(" a ", "1.005"), ("b", 2)]), "A: 1.0\nB: 2.0")

    def test_summarize(self):
        self.assertEqual(summarize([(" a ", "1.005"), ("b", 2)]), "A: 1.0 | B: 2.0")


if __name__ == "__main__":
    unittest.main()
