# Approved intent and coverage matrix: Wayne Code Review

`wayne-code-review` is a static, review-only gate. It freezes one review target,
routes relevant review playbooks, gathers two independent heterogeneous voices over
the same bytes, validates their evidence, synthesizes without inventing agreement,
and emits a return-only verify handoff only after a valid pass.

| ID | Intended behavior | Source | Class | Owner | Exact oracle | Case | Status |
|---|---|---|---|---|---|---|---|
| CR01 | Freeze base/head/dirty target and one immutable diff hash before review | `0888631:wayne-code-review/SKILL.md:85-107`; current Phase 1 | intended | main | both voice records carry the fixture patch SHA and one payload SHA | all adapter cases | PASS |
| CR02 | Read plan/spec intent and check planned-missing plus diff-unplanned in both directions | `0888631:wayne-code-review/SKILL.md:103-112,426-431` | intended | intent playbook | report cites the exact spec and offending endpoints; static mutations preserve both directions | dataflow + candidate-static | PASS |
| CR03 | Route explicit review types instead of applying every broad checklist | user correction 2026-07-17; current broad Phase 3/4 | control defect | router | manifest type is exactly `security` or `dataflow`; security final excludes decoys | security + dataflow | PASS |
| CR04 | Preserve general correctness/security checks with evidence and calibrated false positives | `0888631:wayne-code-review/SKILL.md:124-146` | intended | correctness/security playbooks | true shell injection is CRITICAL; argv-list neighbor has no security finding | security pair | PASS |
| CR05 | Use two heterogeneous model families in independent executions | `0888631:wayne-code-review/SKILL.md:8-10,236-303`; user correction | intended | orchestration | exactly Claude and Codex, different non-empty session IDs, same payload SHA | all adapter cases | PASS |
| CR06 | Start both voices before awaiting either result | `0888631:wayne-code-review/SKILL.md:189-214`; current parallel note | intended | orchestration | provider intervals overlap; serial mutation fails | all adapter cases | PASS |
| CR07 | A missing/failed voice is invalid or degraded, never clean dual-voice success | `e43b2d8` why; fail-loud policy | control defect | orchestration | failed provider run returns non-zero `REVIEW_UNAVAILABLE`, empty reviews, and unchanged repo | adapter-failure | PASS |
| CR08 | Reviewer output is findings with severity, confidence, file, line, problem, fix, or exact `NO FINDINGS` | `0888631:wayne-code-review/SKILL.md:221-232,266-275` | intended | report contract | valid schema passes; 22 independent evidence/schema mutations fail | dual-evidence calibration | PASS |
| CR09 | Preserve orphan producer, dead consumer, semantic drift, dual path, and half migration checks | `e624257:wayne-code-review/SKILL.md:160-226` | intended | dataflow playbook | all five classes survive static mutations; half migration names owner, seam, old source, and stale consumer | dataflow + candidate-static | PASS |
| CR10a | Wrong-value dataflow is CRITICAL | `e624257:wayne-code-review/SKILL.md:183-193` | intended | dataflow playbook | both voices prove beta `2400` becomes retry `1000` and classify it CRITICAL | dataflow | PASS |
| CR10b | Pure dead dataflow surface is INFORMATIONAL | `e624257:wayne-code-review/SKILL.md:183-193` | intended | dataflow playbook | severity clause is required by a calibrated static mutation | candidate-static | PASS |
| CR11 | Apply architecture/state-owner lens only to structural diffs | `bcce934:wayne-code-review/SKILL.md`; current optional lens | intended | architecture playbook | static mutations require single-owner evidence and the pure-local-logic decline boundary | candidate-static | PASS |
| CR12 | Synthesis preserves agreement, source-only findings, and contradictions without fabricated confidence | `0888631:wayne-code-review/SKILL.md:307-346` | intended | main synthesis | both hosts preserve confirmed finding, source-only positions, and `UNRESOLVED` without relaunch | disagreement-synthesis | PASS |
| CR13 | Review-only requests never modify code, index, refs, tests, or checkpoint state | current auto-fix conflict; repository review boundary | control defect | main/workers | Git-native tracked diff/state plus untracked metadata, commit count, and adapter before/after hash remain unchanged | all behavior cases | PASS |
| CR14 | User owns judgment resolution; review never applies a judgment fix | `0888631:wayne-code-review/SKILL.md:344-393` | intended | user | no-auto-fix static mutation plus unchanged repositories in both host families | all behavior cases + candidate-static | PASS |
| CR15 | Static review never runs the application or claims runtime success | `fe578b0:wayne-code-review/SKILL.md`; current Scope | intended | code-review/verify boundary | static-only mutation fails; reports retain runtime `UNVERIFIED` | disagreement + candidate-static | PASS |
| CR16 | Final counts, resolution state, and source status match raw artifacts | `0888631:wayne-code-review/SKILL.md:397-412` | intended | report | checker recomputes agreement/disagreement counts and both source positions | disagreement-synthesis | PASS |
| CR17 | Only a valid clean review may emit a return-only checkpoint to `wayne-verify` | `fe578b0:wayne-code-review/SKILL.md:416-428` | intended | checkpoint | calibrated static gate requires clean PASS + return-only; standalone, failed, and disagreement cases create none | all behavior cases + candidate-static | PASS |
| CR18 | No gstack invoke/load/install/reference; approved structured, adversarial, dataflow, and architecture capabilities remain | repository policy; no code-review history depends on gstack | hard boundary | repository/code-review | negative dependency scan plus 34 calibrated static mutations and positive behavior cases | all | PASS |
| CR19 | Caller-selected plan/spec/acceptance sources and the caller-authored orientation summary are frozen into the single provider-neutral payload; both voices receive the same source paths, hashes, and bytes and may not select another normative artifact | current A/D packet contract; user correction 2026-07-20 | control defect | adapter payload | direct payload calibration proves exact bytes/hash, frozen-after-load behavior, path containment, and payload divergence when a source changes | intent-payload | PASS |

Provider-specific `Agent`, `subagent_type`, `which codex`, `codex exec`, Claude
home paths, a fixed timeout, `gh`/`origin/main` shell fallback, and a particular
fingerprint implementation are incidental mechanisms. Heterogeneous identities,
same frozen bytes, parallel start, observable results, and fail-loud status are the
portable behavior contract.

Default review does not authorize edits. The historical auto-fix text is subordinate
to the current review boundary; explicit implementation approval is a separate turn.
