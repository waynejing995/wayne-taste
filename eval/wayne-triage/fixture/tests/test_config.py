import os
import unittest
from unittest.mock import patch

from src.config import service_region


class ServiceRegionTest(unittest.TestCase):
    def test_missing_region_is_visible(self) -> None:
        with patch.dict(os.environ, {}, clear=True):
            with self.assertRaises(KeyError):
                service_region()


if __name__ == "__main__":
    unittest.main()
