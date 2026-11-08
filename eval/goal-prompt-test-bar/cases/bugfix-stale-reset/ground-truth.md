# Ground truth: bugfix-stale-reset (judge only)

Real fix: tasks commit `ef04e00` "stop attempt-count churn from stale-reset racing live reviews". The writer saw parent `3702faf`.

Root cause: `db.reset_stale_in_progress()` requeued `in_progress` rows older than a hardcoded 35 minutes, while `pr_review_agent.CLAUDE_TIMEOUT` gives a review 120 minutes. `scan()` (every 5 min) therefore requeued live reviews; the worker re-claimed them, inflating `attempts` and risking two reviewers on one PR. Second cause: the per-attempt log path `/tmp/pr-review-<repo>-<N>.log` was opened with "w", so a requeue overwrote the earlier attempt's log.

Fix: the window becomes a caller-supplied argument derived from `CLAUDE_TIMEOUT` (budget + 10 min), `<= 0` raises `ValueError`; the log filename gets a per-attempt timestamp suffix.

Tests that shipped (`tests/test_reset_stale_in_progress.py`, temp SQLite via monkeypatched `db.DB_PATH`): live review inside the window is not reset; a genuinely stale row is reset; just-under-window boundary not reset; non-positive window rejected; invariant window > budget. No test directory existed before the fix.

What a strong goal asks for: a regression unit test on a temp DB that fails on `3702faf` (a 40-minute-old in_progress row gets requeued) and passes after; boundary around the window; the log-overwrite fix proven (two attempts → two files); diff branch coverage; a light smoke (service restart or a scan tick) at most. Property tests are not needed.
