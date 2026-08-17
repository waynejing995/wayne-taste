# Wayne Code Review eval

This harness optimizes one existing `wayne-code-review` skill from frozen history
and behavior. Generated workspaces, provider homes, traces, and candidates belong
under gitignored `eval/.runs/wayne-code-review/`.

The first target is `security-only-routing`: an explicit security-only request has
one real command-injection defect and two non-security decoys. The control must
reproduce a broad/unfocused review or another exact boundary failure before a
candidate is eligible.

No gstack-named skill, path, command, or content is part of this harness.

## Lanes

`check_candidate_static.py` is the live lane. It reads the accepted skill directory
and gates what its prose promises: frontmatter shape, one `references/reviewer-protocol.md`
whose bytes both voices receive, a Phase 4 that dispatches exactly one Claude and one
Codex voice in parallel with no crosstalk, an explicitly labelled single-voice
degradation, static-only scope, judgment calls reaching the user, never committing,
a return-only `wayne-verify` handoff that does not auto-invoke it, and a negative
`gstack` dependency scan. `calibrate_candidate_static.py` proves each gate fails on
one seeded violation and passes on the pristine skill; it defaults to the repository's
`wayne-code-review/` directory.

```bash
uv run --no-project python eval/wayne-code-review/check_candidate_static.py wayne-code-review
uv run --no-project python eval/wayne-code-review/calibrate_candidate_static.py
```

Frozen patch bytes and "two valid voices of different model families or the run
fails" are not skill obligations. They belong to the Pi saved workflow
`wayne-code-review-flow` (`pi-config/workflows/saved/wayne-code-review-flow.json`),
which is the formal gate. No lane here executes that workflow.

`check_trial.py` is the behavior lane. It reads the user-visible review output plus
the Git-native mutation boundary — nothing else — so it runs against what the prose
skill actually produces. `calibrate.py` prepares the four `cases/` workspaces with
`prepare_trial.sh` against the real skill directory and proves the oracle on five
valid outputs and thirteen seeded violations.

```bash
uv run --no-project python eval/wayne-code-review/calibrate.py
bash eval/wayne-code-review/prepare_trial.sh security-only-routing wayne-code-review eval/.runs/wayne-code-review/trial
uv run --no-project python eval/wayne-code-review/check_trial.py eval/.runs/wayne-code-review/trial \
  --case security-only-routing --output eval/.runs/wayne-code-review/trial/output.txt
```

The Python dual-review runner, its provider-neutral intent payload, its review
playbooks, its JSON reviewer schema, and its evidence bundle were removed with the
rejected candidate. The lanes and contracts that existed only for them —
`check_cli_wrapper.py`, `check_intent_payload.py`, `check_adapter_failure.py`,
`check_dual_evidence.py`, `calibrate_dual_evidence.py`, `reviewer-schema.json`, the
external runner trace schema, and the duplicate top-level trial task prompt — are
deleted, not disabled. Every file left here applies to the accepted skill.

`check_trial.py` and `check_candidate_static.py` emit `AI_REVIEW_REQUIRED`.
Their report wording, frontmatter scans, and lexical findings are inputs to
[the blind semantic rubric](semantic-rubric.md), which judges the prose review output
and the Git before/after evidence, not final semantic verdicts.

Trial scope freezes the starting Git status and tracked diff before review, then
compares them afterward. It never walks or hashes unrelated untracked contents.
