import unittest

from slugify import slugify, slugify_tag, slugify_title


class SlugTest(unittest.TestCase):
    def test_basic(self):
        self.assertEqual(slugify(" Hello World "), "hello-world")

    def test_collapses_repeated_spaces(self):
        self.assertEqual(slugify("a  b"), "a-b")

    def test_title(self):
        self.assertEqual(slugify_title("My Post"), "my-post")

    def test_tag(self):
        self.assertEqual(slugify_tag("Big News"), "big-news")


if __name__ == "__main__":
    unittest.main()
