import unittest

from src.tokenizer import remove_suffix


class RemoveSuffixTest(unittest.TestCase):
    def test_absent_suffix_preserves_value(self) -> None:
        self.assertEqual(remove_suffix("token", ".tmp"), "token")


if __name__ == "__main__":
    unittest.main()
