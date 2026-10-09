# Contained classifier eval failure

Triage this wrong-output failure. The full input and runnable evaluator are local.

Run:

```bash
uv run --no-project python -m scripts.evaluate_ranker
```

The evaluator is the pass/fail contract for four ordered score bands. Its failures trace to both the band metadata in `src/rank_policy.py` and the boundary comparison in `src/ranker.py`, so the cause spans two internal files but no public interface or shared schema. Diagnose and route without editing the implementation or evaluator.

Handoff approval: granted for one return-only internal Wayne packet.
