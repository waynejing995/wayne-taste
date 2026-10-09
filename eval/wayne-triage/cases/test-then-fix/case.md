# Small bug without a regression test

Triage this wrong-output failure. The full input and reproduction method are here.

The contract in `src/slug.py` requires underscores to become hyphens. Reproduce with:

```bash
uv run --no-project python -c 'from src.slug import slugify; assert slugify("two_words") == "two-words"'
```

The command fails, but the repository has no permanent test for `slugify`. The cause is internal to this one function and the fix is estimated at two lines. Diagnose and route; do not patch it or add the missing test.

Handoff approval: granted for one return-only internal Wayne packet.
