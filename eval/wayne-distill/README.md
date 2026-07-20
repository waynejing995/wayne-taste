# Wayne Distill eval

This harness freezes the current Distill control and checks the owner/routing
cleanup without executing the expensive session scanner.

```bash
uv run eval/wayne-distill/calibrate.py
```

The scanner is protected by its control hash. The deterministic gate owns only
static ownership, exact input syntax, Flow edges, and unchanged script bytes.
