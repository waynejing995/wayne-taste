# Checker notes: static contract lane

These notes cover the live lane: `check_candidate_static.py` reading the accepted
`wayne-code-review/` skill directory, and `calibrate_candidate_static.py` proving
each of its gates.

## What the static checker gates

The checker asserts what the accepted skill's prose actually promises, and nothing
more. Every gate below must pass on the pristine skill.

| Gate | Requirement |
|---|---|
| frontmatter | exactly `name` and `description`; `name` is `wayne-code-review`; description non-empty |
| required resources | `references/reviewer-protocol.md` and `references/design-conformance.md` are each cited in the body and exist as non-empty regular files |
| voice identities | the body names both Claude and Codex |
| dispatch shape | Phase 4 contains exactly two `**Voice N — ...**` blocks, one Claude and one Codex |
| shared prompt | a Phase 4 paragraph states both voices receive the same bytes from `references/reviewer-protocol.md` |
| no crosstalk | a Phase 4 paragraph states neither voice sees the other's output or the structured review |
| parallel | Phase 4 requires parallel or concurrent dispatch |
| labelled degradation | an unavailable voice is reported explicitly and never presented as dual-voice |
| gate ownership | the body names `wayne-code-review-flow` as the formal gate |
| static only | the body declares static-only scope |
| user sovereignty | judgment calls route to the user, the user decides, and judgment-call fixes are applied only after approval |
| auto-fix scope | the no-approval path is introduced by `without asking:` and enumerates at least three mechanical items |
| no commit | the body states the skill never commits |
| committed target | Phase 1 states the target is already committed and never the working tree |
| target inputs | Phase 1 takes the target from an open PR (`gh pr view`) or an explicit `<base>..<head>` range |
| resolved pair | Phase 1 assigns both `BASE_SHA` and `HEAD_SHA` from `git rev-parse --verify` |
| no-target refusal | a Phase 1 refusal bullet covers "no PR or range was given" instead of inferring a base |
| dirty-tree refusal | a Phase 1 refusal bullet ties a non-empty `git status --porcelain` to uncommitted and untracked files being outside the range |
| fixed diff pair | every `git diff` / `git log` line in the body names both `BASE_SHA` and `HEAD_SHA`, the shared reviewer prompt included |
| no base inference | no `origin/<ref>` survives in the body |
| no checkpoint handoff | the body never mentions `wayne-checkpoint`, a handoff packet, or `NO_WAYNE_HANDOFF` |
| no verify routing | no sentence routes into `wayne-verify` (hand off / next stage / advances into) without a negation, so its two deliberate sibling mentions stay legal |
| forbidden dependency | no text file in the skill tree mentions `gstack` |
| rule ledger | Phase 2 collects the project's own `AGENTS.md` / `CLAUDE.md` along every touched path and writes them into a ledger table |
| frozen rule reads | those rule files are read out of the object store at `HEAD_SHA` (`git cat-file -e` / `git show`), never off the working tree |
| either endpoint | the probe covers `BASE_SHA` as well as `HEAD_SHA`, so a rule file deleted inside the range is still collected |
| design agent | a design-conformance agent is dispatched as a third finding source carrying `references/design-conformance.md` |
| design agent placement | that dispatch lives outside Phase 4, so the dual-voice count there stays at exactly two |
| ledger containment | the rule ledger goes to the design agent and to neither adversarial voice prompt |
| ledger adjudication | Phase 5 rules every merged finding against the ledger |
| no silent suppression | a rule-contradicted finding is reported naming the rule `file:line`, never fixed and never dropped |
| doc justification | where a doc describes the changed design, it must be updated inside the range and say why |
| no doc demand | the absence of a design doc is never filed as a finding |

The ten ledger and design gates exist because the skill's newest logic is the part
most easily paraphrased away. A ledger assembled from the working tree reads today's
conventions into an old range, so `frozen rule reads` asserts the object-store form
specifically, not merely that rules are read. `either endpoint` covers the case that
form alone still misses: a rule file deleted inside the range exists only at
`BASE_SHA`, and a HEAD-only probe reports "no doc governs this path" for the very
diff that removed the doc. `design agent placement` and
`ledger containment` are the two halves of one boundary: the design agent is a third
*finding source*, so it must be dispatched where the voice count is not affected, and
the ledger must not leak into the two prompts that are required to be byte-identical
— an asymmetric hint to one voice, or a shared one to both, ends the dual-voice
contract that CR20 gates. `no silent suppression` gates the residue of adjudication:
a checker that only asked whether findings are adjudicated would pass a skill that
adjudicates by deleting, which is how the same false positive returns every review.
`doc justification` and `no doc demand` are deliberately a pair — the check is scoped
to docs that exist, and a skill that satisfies the first by demanding docs everywhere
fails the second.

Two obligations are deliberately **not** gated here, because the accepted skill does
not carry them:

- **Frozen review bytes.** Each voice runs `git diff {BASE_SHA} {HEAD_SHA}` itself over
  the pair Phase 1 fixed. One frozen patch with a `sha256` that both voices read
  belongs to the Pi saved workflow
  `pi-config/workflows/saved/wayne-code-review-flow.json`.
- **Two valid voices or the run fails.** SKILL.md Phase 4 permits a declared,
  labelled Claude-only degradation. The hard two-voice requirement is the same
  workflow's. The skill-side residue — the degradation must be labelled — is gated.

## Calibration mutations

`calibrate_candidate_static.py` clones the skill, seeds one violation, and requires
the matching finding. It first requires zero findings on the pristine skill.

| Mutation | Seeded violation | Expected finding |
|---|---|---|
| `missing-skill` | delete `SKILL.md` | `missing SKILL.md` |
| `no-frontmatter` | strip the frontmatter block | `must start with YAML frontmatter` |
| `unclosed-frontmatter` | drop the closing delimiter | `no closing delimiter` |
| `empty-body` | keep only the frontmatter | `SKILL.md body is empty` |
| `missing-protocol` | delete `references/reviewer-protocol.md` | `missing required resource` |
| `empty-protocol` | blank that file | `required resource is empty` |
| `symlink-protocol` | replace it with a symlink | `not a symlink` |
| `unreferenced-protocol` | repoint the body link at another path | `body does not reference` |
| `missing-design-protocol` | delete `references/design-conformance.md` | `missing required resource` |
| `empty-design-protocol` | blank that file | `required resource is empty` |
| `symlink-design-protocol` | replace it with a symlink | `not a symlink` |
| `unreferenced-design-protocol` | repoint the Phase 3 dispatch link at another path | `body does not reference` |
| `frontmatter-name` | rename the skill | `frontmatter name must be` |
| `frontmatter-extra` | add a third frontmatter key | `frontmatter keys must be exactly` |
| `frontmatter-duplicate` | repeat the `name` key | `duplicate frontmatter key` |
| `frontmatter-invalid-line` | drop the `:` from a frontmatter line | `invalid frontmatter line` |
| `empty-description` | blank the description value | `description must be non-empty` |
| `voice-identity` | rename Codex throughout | `both Claude and Codex voices` |
| `no-phase-4` | delete the whole Phase 4 section | `no Phase 4 dual voice dispatch section` |
| `drop-voice-2` | delete the whole Voice 2 dispatch block | `must dispatch exactly two voices` |
| `third-voice` | add a Voice 3 dispatch block | `must dispatch exactly two voices` |
| `voice-relabel` | make Voice 2 a non-Codex provider | `one Claude voice and one Codex voice` |
| `per-voice-prompt` | let each voice get its own written prompt | `same bytes from` |
| `crosstalk` | show each voice the other's output | `neither dispatched voice sees` |
| `serial-dispatch` | dispatch sequentially | `parallel reviewer execution` |
| `unlabelled-degradation` | drop the single-voice label | `not presented as dual-voice` |
| `workflow-owner` | stop naming `wayne-code-review-flow` | `must name wayne-code-review-flow` |
| `static-only` | soften the scope heading | `static-only review` |
| `judgment-routing` | stop calling them judgment calls | `route judgment calls to the user` |
| `user-decides` | let the skill decide | `leave the decision to the user` |
| `unapproved-fixes` | apply recommended instead of approved fixes | `judgment-call fixes only after user approval` |
| `commits` | allow committing | `never commits` |
| `working-tree-target` | review the working tree instead of the commits | `already-committed review target` |
| `no-pr-input` | drop the `gh pr view` PR input | `must take the target from an open PR` |
| `unresolved-pr` | declare a PR input but derive BASE_SHA without merge-base | `must resolve one` |
| `unverified-shas` | stop resolving `HEAD_SHA` with `git rev-parse --verify` | `resolve both endpoints with git rev-parse` |
| `no-target-refusal` | delete the "no PR or range was given" refusal bullet | `refuse instead of inferring a base` |
| `dirty-tree-refusal` | drop `git status --porcelain` from the dirty-tree refusal | `git status --porcelain is non-empty` |
| `inferred-diff-target` | make Phase 3 diff `HEAD~1 HEAD` instead of the fixed pair | `scope every git diff/log` |
| `origin-inference` | fall back to `origin/HEAD` when no base is given | `infer a review base from an origin/` |
| `checkpoint-handoff` | promise a `wayne-checkpoint` handoff packet | `promise a wayne-checkpoint handoff` |
| `verify-routing` | hand off to `wayne-verify` as the next stage | `route into wayne-verify as the next stage` |
| `autofix-without-allowlist` | drop the `without asking:` introduction | `enumerated mechanical allowlist` |
| `autofix-unenumerated` | collapse the allowlist to one open-ended item | `enumerated mechanical allowlist` |
| `forbidden-dependency` | mention `gstack` in the protocol file | `forbidden dependency` |
| `no-rule-ledger` | delete the Phase 2 rule collection and its ledger table | `SKILL.md must build a rule ledger from the project's own AGENTS.md/CLAUDE.md files` |
| `worktree-rules` | read the rule files off the working tree instead of `git show "$HEAD_SHA:<path>"` | `SKILL.md must read rule files from the object store at the frozen HEAD_SHA, not the working tree` |
| `head-only-rules` | probe only `HEAD_SHA` when collecting rule files | `SKILL.md must collect rule files present at either endpoint of the range` |
| `no-design-agent` | delete the Phase 3 design-conformance dispatch | `SKILL.md must dispatch a design-conformance agent as a third finding source` |
| `design-agent-as-voice` | move the design agent into Phase 4 as a third voice block | `SKILL.md must dispatch the design-conformance agent outside Phase 4` |
| `ledger-to-voices` | append the rule ledger to the shared voice prompt | `SKILL.md must keep the rule ledger out of both adversarial voice prompts` |
| `no-adjudication` | delete the Phase 5 "Adjudicate against the ledger" section | `SKILL.md must adjudicate findings against the rule ledger` |
| `silent-suppression` | drop a rule-contradicted finding without naming the rule | `SKILL.md must report a rule-contradicted finding instead of fixing or dropping it` |
| `no-doc-justification` | let a design change land with the doc left describing the replaced design | `SKILL.md must require an in-range doc update with a reason where a doc describes the changed design` |
| `demand-docs` | file the absence of a design doc as a finding | `SKILL.md must not demand design docs where the project keeps none` |

Do not weaken a gate after observing candidate output. A gate that cannot fail on a
real mutation of the skill text is not a gate.

## Behavior cases

`cases/` holds four frozen fixtures — `security-only-routing`,
`security-safe-neighbor`, `dataflow-half-migration`, and `disagreement-synthesis` —
prepared by `prepare_trial.sh` and read by `check_trial.py`. `security-only-routing`
carries one real command-injection defect in `src/export.py` plus a deliberate
out-of-scope formatting decoy; the neighboring regression replaces the defect with a
validated argv call so a candidate cannot always emit the target issue. The fixtures
are byte-frozen and unchanged.

`check_trial.py` reads only the user-visible review output and the Git-native
mutation boundary, so it scores what the prose skill actually produces. Per case it
requires the target finding with its file, line, severity, and mechanism; absence of
the out-of-scope decoy; the half-migration endpoints and wrong-value consequence;
preserved disagreement with runtime `UNVERIFIED`; and source attribution for both
voices — or, when Codex is reported missing, an explicit single-voice label.
`calibrate.py` proves it on five valid outputs and thirteen seeded violations,
including `undeclared-single-voice`, `no-claude-attribution`,
`unlabelled-degradation`, and `repository-write`.

## Harness freeze

`harness.sha256` freezes this directory only. It does not cover the skill tree —
`control.sha256` does that — so an edit to `wayne-code-review/SKILL.md` never changes
it, and an edit to any file here always does. Recompute it after changing anything
under `eval/wayne-code-review/`:

```bash
HASH=$(find eval/wayne-code-review -type f ! -path '*/__pycache__/*' ! -name harness.sha256 -print0 \
  | LC_ALL=C sort -z | xargs -0 sha256sum | sha256sum | cut -d' ' -f1)
printf '%s  eval/wayne-code-review (excluding harness.sha256 and __pycache__)\n' "$HASH" \
  > eval/wayne-code-review/harness.sha256
```

Run it from the repository root. The exclusions are exactly the two the file's own
text names: itself and `__pycache__`. Re-running the `find` pipeline alone and
comparing against the recorded digest re-verifies the freeze.

## Removed with the rejected candidate

The Python dual-review runner, its provider-neutral intent payload, its JSON reviewer
schema, and the typed route contract (`REVIEW_TYPE` / `IN_SCOPE` / `OUT_OF_SCOPE` /
`MUTATION_POLICY`) are gone. The lanes that existed only to check them —
`check_cli_wrapper.py`, `check_intent_payload.py`, `check_adapter_failure.py`,
`check_dual_evidence.py`, `calibrate_dual_evidence.py`, and `reviewer-schema.json` —
were deleted, along with `trace_schema.md` (the external runner's JSONL contract),
the duplicate top-level `trial-task.md` superseded by each case's own `task.md`, and
the trace/manifest/session oracle with its `M01`–`M18` mutation design.
`approved-intent.md` records which intended behaviors that leaves `UNCOVERED`,
`SUPERSEDED`, or owned by the workflow.
