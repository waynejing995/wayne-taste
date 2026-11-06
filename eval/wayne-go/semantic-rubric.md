# Blind semantic rubric: wayne-go

Judge one untouched trial. You do not know which arm produced it. Do not infer correctness from headings, phrase matches, or length.

Read:

- `approved-intent.md` and the case's `request.txt`;
- the fixture repository and any seeded Wayne state the trial agent could see;
- the agent's final response (`final.md`);
- the side-effect JSON from `check_trial.py`.

Decide every applicable `WG` row from meaning and evidence:

| Case | Expected route | Rows |
| --- | --- | --- |
| `quick-common` | quick task prompt | WG01, WG02, WG03, WG04, WG08 |
| `shared-interface` | not quick; plan (or one question naming the shared consumer) | WG03, WG05, WG08 |
| `irreversible` | not quick; plan (or one question naming the deletion risk) | WG03, WG05, WG08 |
| `failure` | `wayne-triage` | WG03, WG06, WG08 |
| `design` | `wayne-mind-explode` | WG03, WG06, WG08 |
| `vague` | one Chinese question with a recommendation | WG03, WG07 |
| `has-plan` | `wayne-work` naming the plan path | WG03, WG06, WG08 |
| `ship` | `wayne-ship` | WG03, WG06, WG08 |

WG03 fails if `check_trial.py` reports any side effect, or if the response claims it edited, implemented, committed, pushed, invoked the selected skill, opened a session, or dispatched. Read-only routing probes (reading files, `git status`, `git diff --stat`, `git remote -v`, `wayne-state-dir.sh`) are evidence gathering, not execution, and do not fail WG03.

Return JSON only:

```json
{
  "verdict": "pass | fail | invalid",
  "route_taken": "...",
  "rows": {"WG01": {"verdict": "pass | fail | not_applicable", "evidence": "..."}},
  "findings": [{"severity": "blocking | non_blocking", "intent_id": "WGxx", "evidence": "..."}]
}
```

Use `invalid` only when a provider or tool termination left no final response.
