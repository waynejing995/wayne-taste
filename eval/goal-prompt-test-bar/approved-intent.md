# Approved intent: goal-prompt test bar

Sources: "强化测试部分，unit，test，分支测试，属性测试"; "e2e 我觉得倒是其次……unit test 啥的那种能 mock 数据的要做的很完备"; "不要为了 0.1% 的发生概率造护栏"; "能正确的报出 error 就行"; "在有完备测试的情况下，我觉得能试试". Global rules: `/srv/wayne-skills/CLAUDE.md` (Harness gates earned, Occam, Fail loud). Pre-existing contract: control `_shared/task-prompt.md` sha256 `3dc8c346…`.

| ID | Intended behavior of the generated goal | Source | Oracle |
| --- | --- | --- | --- |
| TB1 | Verification names concrete unit tests that use fabricated/mocked inputs and assert the unit's own output, for the logic the task changes. "tests pass" alone fails. | quoted testing requirement | blind judge |
| TB2 | Each named test is tied to a concrete bug it catches (from the report, git history, or a plausible real input). | quoted probability requirement | blind judge |
| TB3 | Changed-branch coverage is required and measured on the diff, not as a global percentage. | quoted testing requirement | blind judge |
| TB4 | A bug fix carries a regression test that fails before the fix and passes after, shown by both runs. Not applicable to feature cases. | brief (e) | blind judge |
| TB5 | Property-based tests appear only where a one-line invariant exists and the code is bug-prone; otherwise absent or ruled out. Their absence is not a failure. | quoted testing and probability requirements | blind judge |
| TB6 | End-to-end is a light smoke through the real entrypoint (or says why it cannot run); the goal does not make a full e2e suite or e2e-only proof the completion gate. | quoted e2e requirement | blind judge |
| TB7 | Forbidden substitutes are excluded: mock-echo, source-text assertion, no-assert coverage, skip/xfail/loosen a failing test. The goal does not ask for any of them. | brief (f) | blind judge |
| TB8 | No tests, guards, retries, or recovery logic for implausible scenarios; error paths only need the error surfaced with its cause. | quoted probability and error-reporting requirements | blind judge |
| TB9 | Pre-existing goal-prompt behavior holds: one outcome, grounded facts, task-local boundaries, real entrypoint with forbidden fake, no secret value, Chinese confirm for goal + cwd, no dispatch or mutation. | `eval/wayne-goal-prompt/approved-intent.md` GP01–GP08 | deterministic (mutation) + blind judge |
| TB10 | Goal block ≤ 4,000 characters. | brief | deterministic |

Cases (frozen): `feature-review-parallel` (feature, real request 2026-11-05), `bugfix-stale-reset` (real bug fixed in tasks `ef04e00`; writer sees `3702faf` only), `monitor-preprocess` (feature, real request 2026-11-05), `heldout-teams-markdown` (held-out real bug fixed in `1cb20c3`; writer sees `6d31a8c` only).
