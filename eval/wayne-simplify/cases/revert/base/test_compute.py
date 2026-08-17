import unittest

import compute


class ExpensiveTest(unittest.TestCase):
    def test_expensive(self):
        self.assertEqual(compute.expensive(3), 9)


if __name__ == "__main__":
    unittest.main()
