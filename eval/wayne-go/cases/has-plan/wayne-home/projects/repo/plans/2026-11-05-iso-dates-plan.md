---
status: approved
topic: iso-dates
---

# Plan: ISO dates in CLI list

## U1 — render due dates as YYYY-MM-DD

- Files: `src/tasks/format.py`, `tests/test_format.py`
- Change `render` to format `due` with `%Y-%m-%d`; update `RenderTest.test_render_open_task`.
- Verify: `PYTHONPATH=src uv run --no-project python -m unittest discover -s tests -v`
