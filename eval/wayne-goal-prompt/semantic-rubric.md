# Blind semantic rubric: Wayne Goal Prompt

Judge one untouched composition trial. Do not infer correctness from headings,
section order, phrase matches, punctuation counts, or the observation count.

Read:

- the case task and complete repository evidence available to the trial agent;
- the candidate skill and its directly linked references;
- the agent's final response and Git status/diff evidence;
- the JSON observations from `check_trial.py`.

For the selected case, decide every applicable `GP01`-`GP08` row in
`approved-intent.md` from meaning and evidence. In particular, distinguish one
user-owned decision from one question-mark character, accept equivalent
organization and wording, and reject same-shaped prose that invents scope, weakens
real-path proof, leaks a secret, copies plan mechanics, or advances before
confirmation.

Return JSON only:

```json
{
  "verdict": "pass | fail | invalid",
  "rows": {
    "GP01": {"verdict": "pass | fail | not_applicable", "evidence": "..."}
  },
  "findings": [
    {"severity": "blocking | non_blocking", "intent_id": "GPxx", "evidence": "..."}
  ]
}
```

Use `invalid` only when provider/tool termination or missing trial evidence prevents
a behavioral judgment. A lexical observation without source-grounded semantic
evidence is not a finding.
