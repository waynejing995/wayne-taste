import unittest

from delivery import DEFAULT_TIMEOUT_MS, TeamConfig, primary_timeout, retry_timeout


class TimeoutTest(unittest.TestCase):
    def test_default_remains_backward_compatible(self) -> None:
        config = TeamConfig(team_id="alpha")
        self.assertEqual(primary_timeout(config), DEFAULT_TIMEOUT_MS)
        self.assertEqual(retry_timeout(config), DEFAULT_TIMEOUT_MS)

    def test_primary_path_uses_the_selected_team_timeout(self) -> None:
        config = TeamConfig(team_id="beta", timeout_ms=2400)
        self.assertEqual(primary_timeout(config), 2400)


if __name__ == "__main__":
    unittest.main()
