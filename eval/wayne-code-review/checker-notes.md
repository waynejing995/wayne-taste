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
| required resource | `references/reviewer-protocol.md` is cited in the body and exists as a non-empty regular file |
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
| return-only handoff | a paragraph ties `return-only` and `wayne-verify` to not auto-invoking it |
| gate precondition | a paragraph binds packet emission to `GATE: PASS` restrictively, names `wayne-code-review-flow`, and names the `NO_WAYNE_HANDOFF` refusal |
| forbidden dependency | no text file in the skill tree mentions `gstack` |

Two obligations are deliberately **not** gated here, because the accepted skill does
not carry them:

- **Frozen review bytes.** Each voice runs `git diff origin/{BASE}` itself. One
  frozen patch with a `sha256` that both voices read belongs to the Pi saved
  workflow `pi-config/workflows/saved/wayne-code-review-flow.json`.
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
| `auto-invoke` | auto-invoke `wayne-verify` | `does not auto-invoke` |
| `ungated-handoff` | emit the packet whatever the gate said | `NO_WAYNE_HANDOFF` |
| `no-handoff-refusal` | drop the `NO_WAYNE_HANDOFF` return | `NO_WAYNE_HANDOFF` |
| `autofix-without-allowlist` | drop the `without asking:` introduction | `enumerated mechanical allowlist` |
| `autofix-unenumerated` | collapse the allowlist to one open-ended item | `enumerated mechanical allowlist` |
| `forbidden-dependency` | mention `gstack` in the protocol file | `forbidden dependency` |

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
