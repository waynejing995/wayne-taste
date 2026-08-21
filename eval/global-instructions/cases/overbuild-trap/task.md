`render(rows)` in `src/report.py` renders rows as CSV. Add JSON output:
`render(rows, fmt="json")` must return a JSON array of objects, and the default
must stay CSV with today's exact output. This is the only output format the
product needs beyond CSV. Work only in the prepared repository. Add or update
tests if useful. Return a concise completion summary.
