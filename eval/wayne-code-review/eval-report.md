# Eval: wayne-code-review — control vs candidate

## Current state (2026-08-17)

The accepted implementation of `wayne-code-review` is the **prose skill** at
`wayne-code-review/SKILL.md` plus its single `references/reviewer-protocol.md`. The
Python-runner candidate scored below was **rejected by the user**; its runner,
provider-neutral intent payload, review playbooks, and JSON reviewer schema are gone
from the repository.

Live deterministic result against the accepted skill:

| Gate | Result |
|---|---|
| Candidate static contract (`check_candidate_static.py wayne-code-review`) | pass: 0 findings |
| Candidate static calibration (`calibrate_candidate_static.py`) | pass: 1 positive + 54 independent mutations |
| Behavior oracle calibration (`calibrate.py`) | pass: 5 valid outputs + 13 independent mutations, seeded from the real skill directory |

`check_trial.py` was rewritten to score only the user-visible review output and the
Git-native mutation boundary, so it runs against the accepted prose skill; the
deleted runner's JSON evidence bundle is no longer required and its validators are
gone. No live agent trial has been scored against the accepted skill yet, so every
behavior row in `approved-intent.md` is `UNRUN` rather than `PASS`. Frozen patch bytes
and the two-valid-voices requirement moved to the Pi saved workflow
`pi-config/workflows/saved/wayne-code-review-flow.json`, which no lane here executes.
`approved-intent.md` carries the per-row coverage truth.

## Historical A/B (2026-07-17) — scored the rejected candidate

Retained as history. Every verdict below describes the Python-runner candidate, not
the accepted skill, and several of the lanes that produced them no longer exist.

- Control Git tree: `1d374a8ecdca654b0b86f05d3950fad089dc649a`
- Control `SKILL.md`: 457 lines, 2,767 words, SHA-256
  `de5743596934f0abbb9652ae50a8c373a03819301d7562de614bca667a457e30`
- Candidate source-tree SHA-256: `588b08116a8dbba3f2bfba36f2abc6648445dbe824dbecfd4e4a04372fa7f9d1`
- Candidate `SKILL.md`: 168 lines, 1,063 words
- Host models: Claude `opus` / high and Codex
  `dvue-aoai-001-gpt-5.6-sol` / high

| Case | Primary host | Control | Candidate | Candidate observation |
|---|---|---|---|---|
| security-only-routing | Claude | fail: no deterministic heterogeneous evidence | pass | both raw voices identify `src/export.py:8` as CRITICAL shell injection; no decoy |
| security-only-routing | Codex | fail: no deterministic heterogeneous evidence | pass | Codex primary still launches an independent Claude and Codex pair |
| security-safe-neighbor | Claude | fail: no deterministic heterogeneous evidence | pass | both raw voices return `NO FINDINGS`; no security/style false positive |
| security-safe-neighbor | Codex | fail: no deterministic heterogeneous evidence | pass | both raw voices return `NO FINDINGS`; no security/style false positive |
| dataflow-half-migration | Claude | fail: no deterministic heterogeneous evidence | pass | canonical `dataflow`; owner, seam, old source, stale consumer, and `2400 → 1000` consequence retained |
| dataflow-half-migration | Codex | fail: no deterministic heterogeneous evidence | pass | same canonical route and half-migration evidence |
| disagreement-synthesis | Claude | fail: unresolved CRITICAL did not produce FAIL | pass | one confirmed finding, one preserved `UNRESOLVED` disagreement, verdict FAIL |
| disagreement-synthesis | Codex | pass | pass | control-pass behavior retained; no reviewer relaunch |

That run's dual-provider proof — one Claude family and one Codex family per row,
distinct session IDs, one payload hash per pair, overlapping intervals, equal
before/after repository manifests — was produced by the deleted runner and its
evidence bundle. It is not reproducible from the current tree and is not restated
here as a current result.

Historical deterministic gates, with today's disposition:

| Gate | 2026-07-17 result | Disposition |
|---|---|---|
| Forge skill validation | pass | still available |
| Candidate static contract | pass | rewritten for the accepted skill; passes |
| Candidate static calibration | pass: 1 positive + 38 mutations | retargeted: 1 positive + 54 mutations |
| Caller-selected intent payload | pass | lane removed with the runner |
| Dual-evidence/schema calibration | pass: 1 positive + 22 mutations | lane removed; nothing emits that bundle |
| Behavior checker calibration | pass: 4 positives + 11 mutations | rewritten as a prose oracle: 5 positives + 13 mutations |
| Provider failure execution | pass | lane removed with the runner |
| Live-path dual-host smoke | pass | not reproducible; the runner is gone |
| Python compile / shell syntax | pass | still available |

One safe-neighbor run exposed a checker defect: explanatory text saying “no command
injection” was treated as a positive finding. The evaluator was invalidated, changed
to require a severity-bearing positive finding, recalibrated, and the case was rerun
fresh. That cell was not counted as a candidate loss.

## Verdict

Superseded. The 2026-07-17 verdict accepted the Python-runner candidate; the user
subsequently rejected that direction and kept the prose skill. The harness now gates
the prose skill's promises statically and records the resulting coverage gaps in
`approved-intent.md` rather than claiming behavior results it can no longer produce.
