import unittest

from notify import send_email


class NotifyTest(unittest.TestCase):
    def test_send_email(self):
        user = {"email": "a@b.c"}
        self.assertEqual(send_email(user, "hi", "body"), ("email", "a@b.c", "hi", "body"))


if __name__ == "__main__":
    unittest.main()
