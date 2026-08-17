# Approved intent and coverage matrix: Wayne Code Review

`wayne-code-review` is a static review gate. It detects the review target, runs a
structured checklist review, dispatches two independent voices — a Claude subagent
and `codex exec` — over the same `references/reviewer-protocol.md` bytes, synthesizes
without inventing agreement, auto-fixes mechanical issues, routes judgment calls to
the user, and emits a return-only `wayne-verify` handoff. Voices are dispatched as
native subagents or through the Pi saved workflow `wayne-code-review-flow`.

Frozen review bytes and "two valid voices of different families or the run fails"
are obligations of the `wayne-code-review-flow` Pi workflow — the formal gate — not
of the skill checker; rows marked `WORKFLOW` moved there.

Status vocabulary: `PASS` a surviving oracle passes against the accepted skill
today; `WORKFLOW` the obligation is declared in
`pi-config/workflows/saved/wayne-code-review-flow.json` and no harness lane executes
it; `UNRUN` the oracle is calibrated and runnable but no live trial has been scored
against the accepted skill (the last recorded result came from the rejected
candidate); `UNCOVERED` the only oracle was deleted; `SUPERSEDED` the user chose a
different behavior this session and the row is kept as history.

| ID | Intended behavior | Source | Class | Owner | Oracle | Case | Status |
|---|---|---|---|---|---|---|---|
| CR01 | Freeze one review target and one immutable patch `sha256`, same bytes for both voices | `0888631:wayne-code-review/SKILL.md:85-107`; current Phase 1 | intended | `wayne-code-review-flow` | workflow script freezes one patch under `.git`, hashes it with `sha256sum`, and hands both voices that path and hash | `pi-config/workflows/saved/wayne-code-review-flow.json` | WORKFLOW — declared in the workflow script; execution UNRUN, no harness lane runs the workflow |
| CR02 | Read plan/spec intent and check planned-missing plus diff-unplanned in both directions | `0888631:wayne-code-review/SKILL.md:103-112,426-431`; current Phase 2 and the Phase 4 re-arch clause | intended | main | blind dataflow behavior trial | dataflow-half-migration | UNRUN |
| CR03 | Route explicit review types instead of applying every broad checklist | user correction 2026-07-17 | control defect | router | none — the requirement no longer exists | none | SUPERSEDED — the accepted skill applies the broad checklist plus its optional lenses by design; typed routing was a candidate-only requirement |
| CR04 | Preserve general correctness/security checks with evidence and calibrated false positives | current Phase 3 critical/informational categories | intended | main | true shell injection is CRITICAL; argv-list neighbor produces no security finding | security-only-routing + security-safe-neighbor | UNRUN |
| CR05 | Use two heterogeneous model families in independent executions | `0888631:wayne-code-review/SKILL.md:8-10,236-303`; user correction | intended | `wayne-code-review-flow` | workflow pins one Claude model and one GPT model and gives each voice its own agent call | `pi-config/workflows/saved/wayne-code-review-flow.json` | WORKFLOW — declared in the workflow script; execution UNRUN |
| CR06 | Start both voices before awaiting either result | current Phase 4 "Dispatch Both In Parallel"; workflow `parallel([...])` | intended | main dispatch | `serial-dispatch` static mutation over Phase 4 | candidate-static | PASS — the workflow's own parallel execution is UNRUN |
| CR07 | Two valid voices or the run is not a gate pass | `e43b2d8` why; fail-loud policy | control defect | `wayne-code-review-flow` | workflow returns `GATE: FAIL` when the freeze is unusable and treats a missing final gate line as FAIL | `pi-config/workflows/saved/wayne-code-review-flow.json` | WORKFLOW — declared in the workflow script; execution UNRUN. The adapter-failure lane was deleted with the Python runner; the skill-side obligation is CR21 |
| CR08 | Reviewer output is findings with severity, confidence, file, line, problem, fix, or exact `NO FINDINGS` | `0888631:wayne-code-review/SKILL.md:221-232,266-275` | intended | report contract | none — the JSON reviewer schema was deleted with the Python runner, and nothing emits it now | none | UNCOVERED — both the skill and the workflow use the plain-text block in `references/reviewer-protocol.md`, which no oracle checks |
| CR09 | Preserve orphan producer, dead consumer, semantic drift, dual path, and half migration checks | `e624257:wayne-code-review/SKILL.md:160-226`; current Phase 3 dataflow lens | intended | main | blind dataflow behavior trial | dataflow-half-migration | UNRUN |
| CR10a | Wrong-value dataflow is CRITICAL | `e624257:wayne-code-review/SKILL.md:183-193`; current Phase 3 severity-by-consequence rule | intended | main | both voices prove beta `2400` becomes retry `1000` and classify it CRITICAL | dataflow-half-migration | UNRUN |
| CR10b | Pure dead dataflow surface is INFORMATIONAL | current Phase 3 severity-by-consequence rule | intended | main | none — the calibrated static mutation was deleted with the playbook resource | none | UNCOVERED — severity clause survives in SKILL.md and the reviewer protocol, but no gate asserts it |
| CR11 | Apply architecture/state-owner lens only to structural diffs | `bcce934:wayne-code-review/SKILL.md`; current optional cybernetics lens | intended | main | none — the calibrated static mutation was deleted with the playbook resource | none | UNCOVERED |
| CR12 | Synthesis preserves agreement, source-only findings, and contradictions without fabricated confidence | `0888631:wayne-code-review/SKILL.md:307-346`; current Phase 5 | intended | main synthesis | both hosts preserve confirmed finding, source-only positions, and `UNRESOLVED` without relaunch | disagreement-synthesis | UNRUN |
| CR13 | Review-only requests never modify code, index, refs, tests, or checkpoint state | repository review boundary | control defect | `wayne-code-review-flow` | workflow reviews strictly read-only and returns `GATE: PASS`/`GATE: FAIL` | `pi-config/workflows/saved/wayne-code-review-flow.json` | SUPERSEDED for the skill, owned by the workflow — Phase 6 of the accepted skill deliberately auto-fixes mechanical issues; the read-only obligation lives on the gate path |
| CR14 | Judgment calls are the user's: they are batched into one question and only approved ones are applied. A bounded, enumerated mechanical allowlist is auto-fixed without asking | `0888631:wayne-code-review/SKILL.md:344-393`; current Phase 5 User Sovereignty Rule and Phase 6 | intended | user | `judgment-routing`, `user-decides`, `unapproved-fixes`, `autofix-without-allowlist`, and `autofix-unenumerated` static mutations | candidate-static | PASS |
| CR15 | Static review never runs the application or claims runtime success | `fe578b0:wayne-code-review/SKILL.md`; current Scope | intended | code-review/verify boundary | `static-only` static mutation | candidate-static | PASS |
| CR16 | Final counts, resolution state, and source status match raw artifacts | `0888631:wayne-code-review/SKILL.md:397-412`; current Phase 7 | intended | report | checker recomputes agreement/disagreement counts and both source positions | disagreement-synthesis | UNRUN |
| CR17 | The `wayne-verify` handoff is return-only, never auto-invokes the next skill, and is emitted only on a `wayne-code-review-flow` `GATE: PASS` | `fe578b0:wayne-code-review/SKILL.md:416-428`; current Phase 8 | intended | checkpoint | `auto-invoke`, `ungated-handoff`, and `no-handoff-refusal` static mutations | candidate-static | PASS |
| CR18 | No gstack invoke/load/install/reference anywhere in the skill tree | repository policy | hard boundary | repository/code-review | negative dependency scan over every text file plus the `forbidden-dependency` mutation | candidate-static | PASS |
| CR19 | Caller-selected plan/spec sources are frozen into one provider-neutral payload both voices receive | current A/D packet contract; user correction 2026-07-20 | control defect | adapter payload | none — the payload mechanism and its calibration lane were deleted with the Python runner | none | UNCOVERED — the accepted skill appends a 1-line intent summary to the shared prompt instead |
| CR20 | Both dispatched voices receive the same bytes from one `references/reviewer-protocol.md`, and neither sees the other's output or the structured review | current Phase 4 | intended | main dispatch | `drop-voice-2`, `third-voice`, `voice-relabel`, `per-voice-prompt`, and `crosstalk` static mutations | candidate-static | PASS |
| CR21 | An unavailable voice is reported explicitly and the result is never presented as dual-voice | current Phase 4 degradation note | intended | main | `unlabelled-degradation` static mutation; `undeclared-single-voice` and `unlabelled-degradation` behavior mutations | candidate-static + behavior calibration | PASS |
| CR22 | The skill names `wayne-code-review-flow` as the formal gate that owns frozen bytes and two valid voices | current Phase 4 | intended | main | `workflow-owner` static mutation | candidate-static | PASS |
| CR23 | The skill never commits | current Phase 6 and the shipping boundary | intended | user | `commits` static mutation | candidate-static | PASS |

The accepted skill is deliberately provider-specific: it names the Claude Agent tool
with `subagent_type` and `codex exec`, and reads `../_shared/cybernetics-lens.md`.
Provider neutrality was a requirement of the rejected Python-runner candidate only
and is no longer gated.

Default review is not review-only. Phase 6 auto-fixes an enumerated mechanical
allowlist without asking, batches judgment calls into one question for the user,
applies only those the user approved, and never commits.
