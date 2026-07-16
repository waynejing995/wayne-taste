import os
import unittest
from unittest.mock import patch

from src.config import service_region


class RegionContractTest(unittest.TestCase):
    def test_missing_region_uses_explicit_global_region(self) -> None:
        with patch.dict(os.environ, {}, clear=True):
            self.assertEqual(service_region(), "global")


if __name__ == "__main__":
    unittest.main()
