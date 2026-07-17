import unittest

from src.slug import slugify


class SlugTests(unittest.TestCase):
    def test_slug(self) -> None:
        self.assertEqual(slugify("Hello,  Wayne World!"), "hello-wayne-world")


if __name__ == "__main__":
    unittest.main()
