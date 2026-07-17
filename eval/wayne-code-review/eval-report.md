# Eval: wayne-code-review — control vs candidate

Date: 2026-07-17

- Control Git tree: `1d374a8ecdca654b0b86f05d3950fad089dc649a`
- Control `SKILL.md`: 457 lines, 2,767 words, SHA-256
  `de5743596934f0abbb9652ae50a8c373a03819301d7562de614bca667a457e30`
- Candidate source-tree SHA-256: `588b08116a8dbba3f2bfba36f2abc6648445dbe824dbecfd4e4a04372fa7f9d1`
- Candidate `SKILL.md`: 168 lines, 1,063 words
- Host models: Claude `opus` / high and Codex
  `dvue-aoai-001-gpt-5.6-sol` / high

## Paired behavior result

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

Observed result: candidate wins seven cells and ties the one control-pass cell. No
observed task-success, mutation, routing, attribution, or boundary regression.

## Dual-provider proof

Every adapter row has exactly one Claude family and one Codex family, two non-empty
distinct session IDs, one payload hash per pair, overlapping execution intervals,
and equal before/after repository manifests.

| Case | Primary | Route | Payload SHA-256 | Claude session | Codex session |
|---|---|---|---|---|---|
| security-only-routing | Claude | `security` | `b590a8e0af6a…` | `be7cfba6-9fc5-4003-84bc-60566eec4090` | `019f6f1e-60f3-7aa2-868b-63319cb02372` |
| security-only-routing | Codex | `security` | `94451ec382b0…` | `4eb134f1-08ce-41fa-819e-10b363a12648` | `019f6f32-1748-7dc3-bcba-055110ea85a8` |
| security-safe-neighbor | Claude | `security` | `d26837a08a9c…` | `db70be1b-dfcc-4722-af68-7f5bf6359389` | `019f6f36-9208-79c1-853f-8b24ea543f6c` |
| security-safe-neighbor | Codex | `security` | `423422fe10b6…` | `2025cec2-1cc1-4389-849c-39ff8d43f271` | `019f6f36-90a6-7aa2-b57c-e50b83cfcfd1` |
| dataflow-half-migration | Claude | `dataflow` | `792503dd7da5…` | `33ad6589-4a2e-41b7-8507-58eab92a7a74` | `019f6f47-1601-7f30-b9fb-084192c1c764` |
| dataflow-half-migration | Codex | `dataflow` | `6c4a2f4a7ee3…` | `65adeaaa-5678-4d5e-91d0-cc712e658cdb` | `019f6f46-76c2-7a41-93e1-b0f0d9147b46` |

The synthesis-only rows created no `review-evidence` directory, so supplied raw
artifacts were not replaced by fresh reviewers.

## Deterministic gates

| Gate | Result |
|---|---|
| Forge skill validation | pass, 0 errors and 0 warnings |
| Candidate static contract | pass |
| Candidate static calibration | pass: 1 positive + 35 independent mutations |
| Dual-evidence/schema calibration | pass: 1 positive + 22 independent mutations |
| Behavior checker calibration | pass: 4 positives + 11 independent mutations |
| Provider failure execution | pass: non-zero `REVIEW_UNAVAILABLE`, both failures retained, repo unchanged |
| Live-path dual-host smoke | pass: Claude-primary and Codex-primary each produced one Claude + one Codex voice |
| Python compile / shell syntax / diff whitespace | pass |

## Iterations and rejected states

| Candidate tree SHA-256 | Case | Result | Disposition |
|---|---|---|---|
| `b0527d2502f1…` | security / Claude | invalid: Claude rejected the schema meta declaration; nested Codex binary was outside the sandbox | infrastructure invalid, not scored |
| `9389feff2aab…` | security / Claude | invalid: valid evidence was written to ephemeral `/tmp`, outside the harness owner | added explicit `WAYNE_REVIEW_OUTPUT_DIR` ownership; fresh rerun |
| `0976adc0c16b…` | security and safe | target cases pass | retained, then tested on held-out dataflow |
| `251a9238ed5f…` | dataflow / both hosts | fail: models emitted non-canonical aliases and over-broad routes | rejected; canonicalized route tokens and explicit narrow-scope behavior |
| `588b08116a8d…` | all cases / both hosts | pass | accepted candidate |

One safe-neighbor run exposed a checker defect: explanatory text saying “no command
injection” was treated as a positive finding. The evaluator was invalidated, changed
to require a severity-bearing positive finding, recalibrated, and the case was rerun
fresh. That cell is not counted as a candidate loss.

## Verdict

Accept. In these frozen tasks the candidate is behaviorally better than the control
for both Claude-primary and Codex-primary execution, while reducing always-loaded
`SKILL.md` context by 289 lines and 1,704 words. This is an observed paired result,
not a statistical claim.

Residual uncertainty: clean Wayne-pipeline checkpoint emission and specialized
architecture/concurrency/performance routes are protected by calibrated static
contracts but were not exercised as additional live-provider cases in this run.
