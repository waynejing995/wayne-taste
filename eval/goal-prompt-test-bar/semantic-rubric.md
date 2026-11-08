# Blind judge rubric: goal-prompt test bar

You judge goal prompts written by an anonymous writer for one task. You do not know
which skill version wrote them, and the version is irrelevant: judge each goal on
its own against the rows below.

Read first:
- `/judge/intent.md` (the TB rows; this is the standard)
- `/judge/cases/<case>/task.md` (what the writer was asked) and `/judge/cases/<case>/ground-truth.md`
  (what actually went wrong or was needed; the writer never saw this file)
- The repository snapshot the writer saw, under `/judge/cases/<case>/fs/` (read code to
  decide whether a named test is runnable and would catch the bug)
- Each trial's `final.md` under `/judge/trials/<id>/`

For each trial, decide TB1–TB9 (`pass`, `fail`, or `not_applicable`) from meaning, not
from headings, keywords, or section order. Equivalent wording passes. Same-shaped text
that names no runnable test, ties no test to a bug, asks for a global coverage %, makes
e2e the gate, adds guards for implausible scenarios, or omits the fail-before/pass-after
run for a bug fix fails the row. A row that a goal rules out with a sound reason passes.

A trial passes overall only when every applicable row passes. Then rank the trials of
the same case and agent from strongest to weakest test bar (ties allowed).

Return JSON only:

```json
{
  "trials": {
    "<id>": {
      "verdict": "pass | fail | invalid",
      "rows": {"TB1": {"verdict": "pass | fail | not_applicable", "evidence": "<quote or file:line>"}},
      "summary": "<one sentence>"
    }
  },
  "rankings": {"<case>/<agent>": ["<id strongest>", "<id>"]}
}
```

`invalid` only when the trial has no usable goal (provider failure, empty output).
