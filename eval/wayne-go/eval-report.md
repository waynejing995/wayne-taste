# Eval: wayne-go — no skill vs candidate

Date: 2026-11-05. Models: `auto/claude-opus-5-5` (Claude Code) and `auto/gpt-6.1-sol` (Codex), both at high effort, in bwrap-isolated workspaces (`run_agent.sh`). The task text names the request only; it does not forbid execution, so staying prompt-only (WG03) is the skill's own behavior.

Control: the same agent with a catalog of every installed Wayne skill (`skills-catalog.md`) and the shared task-prompt contract, but no `wayne-go`. Candidate: `wayne-go/`.

## Round 1 — 8 cases × 2 arms × 2 agents

| Layer | Control | Candidate |
| --- | --- | --- |
| Side effects (`check_trial.py`) | 11/16 mutated the repo or Wayne state (edits, a commit, a new test file, a context file) | 16/16 clean |
| Blind AI judge (`semantic-rubric.md`) | 0/16 pass | 11/16 pass |

Candidate failures and the one edit each drove:

| Case | Observed | Edit |
| --- | --- | --- |
| `irreversible` ×2 | took the quick lane for a one-line change to a deletion script | quick-lane exclusion now names code that deletes, deploys, publishes, or migrates; file count does not decide |
| `vague` (Claude) | findings report before the question | the question is returned alone |
| `ship`, `has-plan` (one each) | judge counted read-only probes (`git remote -v`, `wayne-state-dir.sh`) as execution | evaluator defect: rubric WG03 now names read-only probes as allowed; no skill edit |

## Round 2 — candidate only, 8 cases × 2 agents

16/16 side-effect clean; blind judge 14/16. Remaining: `quick-common` (Claude) wrote "follow AGENTS.md / CLAUDE.md" in a repository that has neither → shared contract now names only the rule files that exist; `vague` (Claude) gave no route in `我的建议：` → the recommendation must name one route.

## Round 3 — the three touched cases, candidate only

`quick-common`, `vague`, `irreversible` × 2 agents: 6/6 side-effect clean; by inspection both `irreversible` route to `wayne-plan` naming the deletion risk, both `vague` return one question that names a route, both quick prompts carry the stop-on-scope-growth line and no nonexistent rule file. Round 3 was not re-judged blind.

## Shared contract migration

Both consumers of the old templates were rerun against the shared contract, control = the pre-migration skill text.

**`wayne-goal-prompt`.** Control is the committed tree (`git archive HEAD wayne-goal-prompt`, still holding `goal-prompt-template.md`); candidate reads `_shared/task-prompt.md` (every candidate trace reads it; none reads the old template). Its existing harness and blind rubric (`eval/wayne-goal-prompt/`), 3 cases × 2 agents:

| Case | Control | Candidate |
| --- | --- | --- |
| `compose-real-path` | Claude FAIL (GP02/GP04: invented three-file boundary; secret-safety claim without proof), Codex PASS | 2/2 PASS |
| `existing-plan` | Claude FAIL (GP02: file boundary proven only by `git status`), Codex PASS | 2/2 PASS (plan path and unit IDs kept, unit bodies not copied) |
| `vague-missing` | 2/2 PASS | 2/2 PASS |

Static gates after migration: `check_candidate_static.py`, `calibrate_candidate_static.py` (1 positive, 6 mutations, 1 paraphrase), and `check_dispatch.py` all PASS. The runner now also copies `magpie-models.json` so Codex resolves gateway slugs.

**`delegate-agent-session`.** Control is the brief template as it stood before the edit (the managed skill is not under git; reconstructed verbatim). Each trial writes a brief for a fixed request (Teams `trace-dev`, commit but do not push) against a fixture with a seeded task context. Harness under `eval/.runs/delegate-brief/` (untracked).

| Gate | Control | Candidate |
| --- | --- | --- |
| RESULT block + deliverable path (`check_brief.py`, calibrated on 1 good + 2 mutations) | 4/4 PASS | 4/4 PASS |
| Blind DB01–DB09, round 1 | 2/4 (both Codex invented environment claims) | 0/4: none said repository rules win (DB03) |
| Blind DB01–DB09, round 2 after one edit | — | 4/4 PASS |

The DB03 regression came from the shared contract: an earlier fix made the rule-precedence line conditional on `AGENTS.md`/`CLAUDE.md` existing and dropped `.claude/rules/`, which the old brief named. The contract now lists all three and says to name only the ones that exist; the round-2 fixture has `AGENTS.md` and `.claude/rules/` so the line is exercised.

## Verdict

Accept. Residual uncertainty: one or two trials per cell; `wayne-go` round 3 judged by inspection, not blind; trigger recall of the `wayne-go` description untested; the delegate control is a reconstruction, not a recovered file; delegate round 1 had no rule files in the fixture, so the precedence line was not exercised before round 2.
