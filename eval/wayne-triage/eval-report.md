# Eval: Wayne Triage

## Versions

| Side | Tree SHA-256 | SKILL.md | Forge static |
|---|---|---:|---|
| Control | `9841fbaccd11c8a56acf6261225e7a92890b39209a985795c0e3afab35384252` | 156 lines / 1083 words | 0 errors, 0 warnings |
| Candidate | `d0df1dbd7111e3a6d0d2ff4d0af890a8cec2b386ecf13c57323d3f86ad2a8163` | 169 lines / 1236 words | 0 errors, 0 warnings |

Trials used Claude Opus 4.8 and `dvue-aoai-001-gpt-5.6-sol`, both at high
effort, in fresh isolated workspaces. `checkpoint.sha256` pins the real handoff
dependency; `harness.sha256` pins the final evaluator.

## Paired result

| Case | Claude control | Codex control | Claude candidate | Codex candidate |
|---|---|---|---|---|
| `failure` | FAIL: routed to `wayne-work` | FAIL: routed to `wayne-work` | PASS | PASS |
| `tracker` | FAIL: routed to `wayne-plan` | FAIL: routed to `wayne-plan` | PASS | PASS |
| `missing-data` | PASS | PASS | PASS | PASS |
| `multiple-signal` | FAIL: routed to `wayne-plan` | FAIL: routed to `wayne-plan` | PASS | PASS |
| `no-match` | PASS | PASS | PASS | PASS |
| `approval-denied` | PASS | PASS | PASS | PASS |
| `architecture` | PASS | PASS | PASS | PASS |
| `external-owner` | FAIL: incomplete report | FAIL: incomplete report | PASS | PASS |

The candidate restores triage as the verdict-to-first-capability owner. Internal
implementation routes enter `wayne-test-design`; architecture returns to
`wayne-mind-explode`; external and unresolved routes create no Wayne checkpoint.

## Iterations and evaluator corrections

- The architecture fixture originally named a repro that passed. That cell was
  invalidated, given a real failing repro, and rerun; control then passed on both
  agents and remains a regression gate.
- The evaluator initially rejected a backticked route and required only `config`
  for a config/logic boundary. Those untraceable restrictions were removed and the
  affected cells were rerun under the re-frozen harness.
- Candidate v1 passed 14/16 but compressed the external report.
- Candidate v2 preserved seven sections but one Claude run omitted acceptance
  criteria. The final candidate names the template-owned fields explicitly.
- Chinese `验收标准` and `范围外` are accepted as the user-visible equivalents of
  the English template labels; calibration includes that positive fixture.

## Validation

- Calibration: PASS, 8 valid routes and 13 independent mutations.
- Final candidate behavior: 16/16 PASS; no invalid final cells.
- Live-path smoke: `failure` PASS on Claude and Codex.
- Live tree equals the evaluated final candidate byte-for-byte.
- Forge static and `git diff --check`: PASS.

## Verdict

Accept. Every targeted routing/report failure flips on both models, and every
control-pass approval, missing-data, no-match, and architecture case remains
passing.

Residual uncertainty: the harness does not execute a real 10k-line parallel
fan-out or mutate a live tracker. Those boundaries remain protected by the
unchanged dispatch reference, Git scope observations, and blind review.

## 2026-07-20 tracker-write ownership hotfix

The tracker path now renders a complete proposed comment and cannot describe
publication as part of triage. The legacy observer locates a likely proposal
section and records unchanged tracker state; semantic completeness and publication
meaning belong to the blind rubric, not a heading, keyword, or count proxy. The
missing-section mutation remains observation-calibration evidence.

| Live case | Model | Structural gate | Blind semantic read |
|---|---|---|---|
| `tracker` | Claude Opus 4.8 | PASS | PASS |
| `tracker` | Codex `dvue-aoai-001-gpt-5.6-sol` | PASS | PASS |

Both isolated results rendered a complete proposal, preserved tracker bytes, and
returned a manual `wayne-test-design` handoff without claiming publication. The
candidate tree is `c35b787463cdc4689fa0f83434f2331df5102c791dd5a612d650e416aa428183`
(171 lines / 1265 words); Forge static reports 0 errors and 0 warnings.

The same correction removes the nine triage lexical proxies catalogued in
`eval/REVIEW-consolidated.md`: punctuation counts and wording scans no longer
decide clarification, classification, repro meaning, prior-fix meaning, routing,
or invocation claims. Existing structured fields and immutable artifacts retain
their deterministic checks; prose meaning moves to the independent rubric.

Residual uncertainty for this hotfix: the generic Claude trial runner retained the
final JSON but not the native stream tool trace, so unchanged tracker bytes and the
result prove no observed publication, not the absence of every attempted external
write. A later trace-enabled publication case should close that proof gap.

## 2026-07-21 AI-handoff boundary hotfix

Evidence, scout/tester returns, tracker proposals, external reports, and checkpoint
packets are AI-readable artifacts. Their templates remain useful shared guides, but
headings, field order, exact blocks, and table shape no longer decide meaning.
Immutable tracker/Git state and real Skill/path existence remain observable facts;
the blind rubric owns evidence completeness, routing, attribution, and handoff
meaning. No provider cell was rerun for this prompt-only change.

## 2026-07-22 semantic evaluator migration

The trial checker now emits `AI_REVIEW_REQUIRED`; evidence frontmatter, headings,
route strings, proposal landmarks, and packet fields are observations rather than
semantic failures. Scope evidence now comes from the frozen starting commit, final
Git diff/untracked paths, and native trace instead of recursively reading and
hashing every repository file. The 8-route/13-mutation calibration remains an
observation-coverage test, not a report-correctness oracle.
