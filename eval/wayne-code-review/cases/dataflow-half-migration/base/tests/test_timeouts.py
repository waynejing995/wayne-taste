import unittest

from delivery import DEFAULT_TIMEOUT_MS, TeamConfig, primary_timeout, retry_timeout


class TimeoutTest(unittest.TestCase):
    def test_shared_default_is_used_by_existing_paths(self) -> None:
        config = TeamConfig(team_id="alpha")
        self.assertEqual(primary_timeout(config), DEFAULT_TIMEOUT_MS)
        self.assertEqual(retry_timeout(config), DEFAULT_TIMEOUT_MS)


if __name__ == "__main__":
    unittest.main()
