# Slug normalization spec

- R1: `normalize_slug(text)` lowercases ASCII letters and replaces spaces with one dash.
- R2: empty input returns empty output.
- R3: non-string input raises `TypeError`.
- Pure deterministic function; no I/O, state, concurrency, persistence, auth, network, CLI, or UI.
