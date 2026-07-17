import unittest


class RetryControllerOwnershipTest(unittest.TestCase):
    def test_third_fix_still_has_two_state_writers(self) -> None:
        observed_writers = {"cli-controller", "worker-controller"}
        self.assertEqual(
            observed_writers,
            {"retry-controller"},
            "third attempted fix still leaves two retry-state writers",
        )


if __name__ == "__main__":
    unittest.main()
