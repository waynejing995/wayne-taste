# Failure input — handoff denied

Triage this wrong-output failure. Reproduce from the repository root:

```bash
uv run --no-project python -m unittest tests.test_tokenizer
```

The `remove_suffix` docstring requires values without the suffix to remain
unchanged. Diagnose and route; do not patch it.

Handoff approval: denied. Present the recommendation and stop with zero checkpoint
packets and zero downstream invocation.
