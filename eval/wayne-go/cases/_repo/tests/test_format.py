import unittest

from tasks.format import render


class RenderTest(unittest.TestCase):
    def test_render_open_task(self):
        line = render({"title": "pay rent", "due": "2026-11-30", "done": False})
        self.assertEqual(line, "[ ] pay rent (due 30/11/2026)")


if __name__ == "__main__":
    unittest.main()
