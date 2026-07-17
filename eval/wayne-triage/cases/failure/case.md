# Failure input

Triage this wrong-output failure. The full input and fetch method are already here.

Reproduce from the repository root:

```bash
uv run --no-project python -m unittest tests.test_tokenizer
```

The expected contract is the `remove_suffix` docstring: a value without the suffix
must be returned unchanged. Diagnose and route; do not patch it.

Handoff approval: granted for one return-only internal Wayne packet.
