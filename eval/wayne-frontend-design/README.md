# Wayne Frontend Design eval

This exact-change harness verifies that the candidate differs from the frozen
control only by removal of the duplicate global-owner block. Every bundled
reference remains byte-identical.

```bash
uv run eval/wayne-frontend-design/calibrate.py
```
