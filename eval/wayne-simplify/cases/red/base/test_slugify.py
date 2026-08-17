import unittest

from slugify import slugify


class SlugTest(unittest.TestCase):
    def test_basic(self):
        self.assertEqual(slugify(" Hello World "), "hello-world")

    def test_collapses_repeated_spaces(self):
        self.assertEqual(slugify("a  b"), "a-b")


if __name__ == "__main__":
    unittest.main()
