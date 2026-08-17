import unittest

from billing import invoice_total
from notify import send_email
from reporting import report_line


class NotifyTest(unittest.TestCase):
    def test_send_email(self):
        user = {"email": "a@b.c"}
        self.assertEqual(send_email(user, "hi", "body"), ("email", "a@b.c", "hi", "body"))


class BillingTest(unittest.TestCase):
    def test_invoice_total(self):
        self.assertEqual(invoice_total(["$1,000.005", " 2.5 "]), 1002.5)


class ReportingTest(unittest.TestCase):
    def test_report_line(self):
        self.assertEqual(report_line("total", "$1,234.5"), "total: 1234.50")


if __name__ == "__main__":
    unittest.main()
