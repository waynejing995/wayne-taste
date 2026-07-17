# Retry controller evidence

- Repro: `uv run --no-project python -m unittest tests.test_config`
- Current result: FAIL — retry state has two writers.
- Fix 1 moved ownership from CLI to worker and broke CLI retries.
- Fix 2 mirrored state in both and introduced divergent counters.
- Fix 3 centralized the counter but created a feedback loop after worker restart.
- The symptom and confirmed cause are both in the retry-controller ownership model.
