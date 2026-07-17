Read `/workspace/skill/SKILL.md` completely, follow it as the supplied Wayne Goal
Prompt skill, and read only the direct resources it routes this task to.

Compose a goal prompt only; do not modify files or dispatch it. The raw intent is:

> Fix `src/retry.py` so `retry(operation, max_attempts=3)` retries only
> `TransientError`, stops after the configured attempt count, and immediately
> re-raises every other exception. Keep the public signature. Verification must
> run `uv run --no-project python -m unittest discover -s tests -v` and the real
> entrypoint `uv run --no-project python -m retry_demo`, whose visible final line
> must be `RETRY_DEMO_OK attempts=3`. Do not replace the demo with a direct helper
> call. Do not print or commit the fixture value in `RETRY_API_TOKEN`; refer only
> to that env-var name. Completion means unit tests pass, the real demo prints the
> exact line, non-transient errors are not retried, and no secret value is emitted.

Return the copy-paste goal block and the required confirmation question.
