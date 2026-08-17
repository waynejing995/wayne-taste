# Approved intent and coverage matrix: Wayne Code Review

`wayne-code-review` is a static review gate. It fixes an already-committed review
target — an open PR or an explicit `<base>..<head>` range resolved to `BASE_SHA` and
`HEAD_SHA`, refusing rather than guessing when neither was given, when
`git status --porcelain` is non-empty, or when the range is empty — runs a structured
checklist review over that pair, dispatches two independent voices — a Claude
subagent and `codex exec` — over the same `references/reviewer-protocol.md` bytes,
synthesizes without inventing agreement, auto-fixes mechanical issues, and routes
judgment calls to the user. Nothing is handed off automatically. Voices are dispatched
as native subagents or through the Pi saved workflow `wayne-code-review-flow`.

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
| CR01 | Freeze one already-committed review target and one immutable patch `sha256`, same bytes for both voices | `0888631:wayne-code-review/SKILL.md:85-107`; current Phase 1 | intended | `wayne-code-review-flow` | workflow requires its `base` range, refuses a dirty worktree, freezes one patch under `.git`, hashes it with `sha256sum`, and reports `base_sha`/`head_sha`/`commits` with that path and hash to both voices | `pi-config/workflows/saved/wayne-code-review-flow.json` | WORKFLOW — declared in the workflow script; execution UNRUN, no harness lane runs the workflow |
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
| CR17 | The `wayne-verify` handoff is return-only, never auto-invokes the next skill, and is emitted only on a `wayne-code-review-flow` `GATE: PASS` | `fe578b0:wayne-code-review/SKILL.md:416-428`; deleted Phase 8 | intended | checkpoint | none — Phase 8 and its `auto-invoke`, `ungated-handoff`, and `no-handoff-refusal` mutations were deleted; CR25 now gates the absence | none | SUPERSEDED — the user removed the auto-handoff: `wayne-work` commits per unit, this review runs last over those commits, and `wayne-ship` opens the PR, so no packet is emitted and `wayne-verify` is invoked deliberately instead of routed into |
| CR18 | No gstack invoke/load/install/reference anywhere in the skill tree | repository policy | hard boundary | repository/code-review | negative dependency scan over every text file plus the `forbidden-dependency` mutation | candidate-static | PASS |
| CR19 | Caller-selected plan/spec sources are frozen into one provider-neutral payload both voices receive | current A/D packet contract; user correction 2026-07-20 | control defect | adapter payload | none — the payload mechanism and its calibration lane were deleted with the Python runner | none | UNCOVERED — the accepted skill appends a 1-line intent summary to the shared prompt instead |
| CR20 | Both dispatched voices receive the same bytes from one `references/reviewer-protocol.md`, and neither sees the other's output or the structured review | current Phase 4 | intended | main dispatch | `drop-voice-2`, `third-voice`, `voice-relabel`, `per-voice-prompt`, and `crosstalk` static mutations | candidate-static | PASS |
| CR21 | An unavailable voice is reported explicitly and the result is never presented as dual-voice | current Phase 4 degradation note | intended | main | `unlabelled-degradation` static mutation; `undeclared-single-voice` and `unlabelled-degradation` behavior mutations | candidate-static + behavior calibration | PASS |
| CR22 | The skill names `wayne-code-review-flow` as the formal gate that owns frozen bytes and two valid voices | current Phase 4 | intended | main | `workflow-owner` static mutation | candidate-static | PASS |
| CR23 | The skill never commits | current Phase 6 and the shipping boundary | intended | user | `commits` static mutation | candidate-static | PASS |
| CR24 | The review target is already committed: an open PR or an explicit `<base>..<head>` range resolved to `BASE_SHA`/`HEAD_SHA`, refused rather than inferred when unnamed or when `git status --porcelain` is non-empty, and diffed as that fixed pair by every later phase and the shared reviewer prompt | current Phase 1, Phase 2, Phase 3, and the Phase 4 shared prompt | intended | main | `working-tree-target`, `no-pr-input`, `unverified-shas`, `no-target-refusal`, `dirty-tree-refusal`, `inferred-diff-target`, and `origin-inference` static mutations | candidate-static | PASS |
| CR25 | The skill emits no automatic handoff: no `wayne-checkpoint` packet, and `wayne-verify` is named as a deliberately invoked sibling rather than routed into as the next stage | current Scope and Integration sections | intended | main | `checkpoint-handoff` and `verify-routing` static mutations | candidate-static | PASS |
| CR26 | Phase 2 builds a rule ledger from the project's own `AGENTS.md`/`CLAUDE.md` along every touched path — the directory of each changed file and every ancestor up to the repository root — probing both endpoints so a rule file deleted inside the range is still collected, and reading every version out of the object store at the frozen `BASE_SHA`/`HEAD_SHA` rather than off the working tree | current Phase 2 rule ledger | intended | main | `no-rule-ledger`, `worktree-rules`, and `head-only-rules` static mutations | candidate-static | PASS |
| CR27 | A design-conformance agent is dispatched as a third finding source carrying `references/design-conformance.md`, outside Phase 4 and in the same parallel batch, leaving the dual-voice pair at exactly two | current Phase 3 design-conformance dispatch; `references/design-conformance.md` | intended | design-conformance agent | `no-design-agent`, `design-agent-as-voice`, `missing-design-protocol`, `empty-design-protocol`, `symlink-design-protocol`, and `unreferenced-design-protocol` static mutations | candidate-static | PASS |
| CR28 | The rule ledger reaches only the design-conformance agent; neither adversarial voice receives it, so both still read identical bytes | current Phase 4 ledger-exclusion clause | intended | main dispatch | `ledger-to-voices` static mutation | candidate-static | PASS |
| CR29 | Every merged finding is adjudicated against the ledger as `RULE-BACKED`, `NO GOVERNING RULE`, or `RULE-CONTRADICTED`; a rule-contradicted finding is never fixed and is reported naming the rule `file:line` instead of dropped | current Phase 5 "Adjudicate against the ledger" | intended | main synthesis | `no-adjudication` and `silent-suppression` static mutations | candidate-static | PASS |
| CR30 | The doc-justification check is scoped to docs that exist — where a doc describes the changed design it is updated in-range and says why; where none exists the check is skipped silently, emitting neither a finding nor a note, and never demanding the project start writing design docs | current Phase 3 "changes the design" clause; `references/design-conformance.md` check 2 | intended | main | `no-doc-justification` and `demand-docs` static mutations | candidate-static | PASS |

The accepted skill is deliberately provider-specific: it names the Claude Agent tool
with `subagent_type` and `codex exec`, and reads `../_shared/cybernetics-lens.md`.
Provider neutrality was a requirement of the rejected Python-runner candidate only
and is no longer gated.

Three finding sources, two voices. The design-conformance agent (CR27) is a
dispatched subagent but deliberately **not** a dispatched voice: it reads
`references/design-conformance.md` instead of `references/reviewer-protocol.md`,
carries the rule ledger the two voices are denied (CR28), and answers "does this
contradict the design this repository is running" rather than "what is wrong with
this diff". Its agreement with a voice is therefore never counted as cross-model
confirmation, and the dual-voice gates CR20 and CR05 still mean exactly two. It is
provider-specific in the same way the two voices are — a Claude Agent dispatch with
`subagent_type`, launched in the same parallel batch as Phase 4 — and that
specificity is likewise not gated.

Default review is not review-only. Phase 6 auto-fixes an enumerated mechanical
allowlist without asking, batches judgment calls into one question for the user,
applies only those the user approved, and never commits.
