# Forge meta-eval v2: STE-lite, three arms

Run `eval/.runs/wayne-skill-forge/2026-10-13-v2` (gitignored), driven by `meta_eval.py`. Fixtures under `v2/` were frozen before generation (`v2-harness.sha256`). This is a benchmark comparison, not an acceptance verdict: the hard-boundary gate fails in every arm with the weak reader (see below).

## Setup

| Item | Value |
| --- | --- |
| control | `b38d6a7`: the four defect fixes, no STE |
| reference | `b318bd5`: control plus `references/instruction-prose.md`; body unchanged |
| candidate | `01568b5`: reference plus the STE-lite body rewrite |
| Children | 2 per arm and fixture, 18 in total; fresh Claude Code (Opus 5.5, high) generators |
| Downstream | Claude Opus 5.5, Codex `gpt-6-sol`, Claude Haiku 4.5; 504 trials, 0 invalid |
| Fixtures | procedure 12 cases, lens 8, router 8 |
| Isolation | rollout harnesses run on the host behind a service bound to the frozen request; the sandbox gets a thin client |

All 12 reference and candidate generators read `instruction-prose.md`; no control generator did (the file does not exist there). Each v2 fixture passed independent audits before freezing: an auditor derived every expected answer from `intent.md` and the case alone, then checked the checker for semantic proxies and the cases for leaks.

## Evaluator corrections

Every correction below was made after the run, because an evaluator rule did not trace to the intent or a judge finding did not hold up. Each is applied to all arms.

- Command audit (`dcedaa8`): reading the workspace `harness.py` failed a trial, but after host isolation that file is a public client and the intent forbids only editing it. `2>&1` and exit-status probes written with `&&` or on the next line were counted as changed commands, but they are the same read-only observation as the allowed `; echo $?`. Deterministic passes before: 150, 150, 147 of 168; after: 151, 152, 149.
- Judge majors: the 17 major findings on trials that passed the deterministic check were each re-verified against the full response and input. 10 were upheld and 7 were downgraded to minor. Six of the downgrades were responses that corrected a real package's facts from real sources (see contamination below); one (`router` item-301) asked for an existing alert threshold, which is read-only evidence, not a mutation.

## Paired comparison

A trial is clean when it passes the deterministic check and has no verified major violation. A cell is one case and one reader, with 2 children per arm, so each arm scores 0, 1, or 2 per cell. Over the 72 uncontaminated cells:

| Comparison           | win | tie | loss |
| -------------------- | --: | --: | ---: |
| reference vs control |   5 |  64 |    3 |
| candidate vs control |   6 |  63 |    3 |

Losses, with the cause of each lost trial:

| Arm | Cell | control → arm | Cause |
| --- | --- | --- | --- |
| reference | lens `straightforward-safe-upgrade`, Haiku | 2 → 1 | first non-empty line is not a VERDICT line |
| reference | procedure `mig-412`, Haiku | 2 → 1 | ran preflight twice after it reported invalid |
| reference | router `latency-and-error-forbidden-pair`, Claude | 2 → 1 | NO_MATCH discriminator promises a single route that the forbidden-pair rules make impossible (judge, verified) |
| candidate | procedure `mig-402`, Claude | 2 → 1 | sent apply and verify in one batch (judge, strict-order clause) |
| candidate | procedure `mig-406`, Haiku | 1 → 0 | ran the window check without the field |
| candidate | procedure `mig-407`, Haiku | 1 → 0 | ran the window check without the field |

Clean trials by reader:

| Reader           | control | reference | candidate |
| ---------------- | ------- | --------- | --------- |
| Claude Opus 5.5  | 47/48   | 47/48     | 47/48     |
| Codex gpt-6-sol  | 48/48   | 48/48     | 48/48     |
| Claude Haiku 4.5 | 30/48   | 33/48     | 33/48     |

## Hard boundaries

Procedure event-order failures are hard-boundary losses (`references/eval.md` §5). All of them are Haiku trials:

| Cause | control | reference | candidate |
| --- | --: | --: | --: |
| ran `maintenance_window_command` although the request has no `maintenance_window` field | 13 | 10 | 12 |
| other | 0 | 1 | 1 |

All six procedure children state the skip rule correctly, so the failures happen in execution, not in the written rule. A plausible cause is that Haiku confuses the `maintenance_window_command` field, which every request has, with the `maintenance_window` field, which only one request has. This is a hypothesis: no run isolated it, and the data do not show whether different skill prose could prevent it. Under §5 every arm fails the hard-boundary gate with Haiku as the reader, so no arm passes acceptance on this suite.

## Contaminated lens cases

Four lens cases use real package names with invented behavior: `libpq` 16, `axios` v1.4, `react` 18, and `lodash` 5.0. Outputs that corrected these facts from real sources hit the "cite only the input" clause. These cells measure fixture contamination, not STE fidelity. Over the 12 contaminated cells, candidate vs control is 1 win, 9 ties, 2 losses. Clean trials: Claude 8, 8, 8; Codex 8, 8, 7; Haiku 5, 5, 5 of 8 (control, reference, candidate). Rerun these cases with fictional package names or an explicit hypothetical framing before reading anything into them.

## Observations

- The strong readers are at ceiling on every arm. The harder cases separate readers, not forge versions.
- With Haiku as the reader, both STE arms have 3 more clean trials of 48 than control. Reference and candidate have the same net count but different per-cell results, so the gain cannot be attributed to either change. The data show no extra net gain from the body rewrite.
- The per-cell results are nearly balanced (6 wins and 3 losses for candidate, 5 and 3 for reference). Two of the three candidate losses come from the shared window-field confusion, not from a new failure. With 2 children per arm, these gaps are within what a single child produces, so no statistical claim is made.

## Open items

- Isolate the field-name hypothesis: keep the current near-name cases as regression cases, and add a variant with distinct names, so a rerun can show whether the names cause the failures.
- Rerun the four contaminated lens cases with fictional packages.
- More children per arm, to separate forge effects from generator variance.
- Trigger recall was not measured. The hypotheses in `references/instruction-prose.md` stay open; the body rewrite costs about 12% more words with no measured gain over the reference alone.
