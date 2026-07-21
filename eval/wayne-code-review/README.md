# Wayne Code Review eval

This harness optimizes one existing `wayne-code-review` skill from frozen history
and behavior. Generated workspaces, provider homes, traces, and candidates belong
under gitignored `eval/.runs/wayne-code-review/`.

The first target is `security-only-routing`: an explicit security-only request has
one real command-injection defect and two non-security decoys. The control must
reproduce a broad/unfocused review or another exact boundary failure before a
candidate is eligible.

No gstack-named skill, path, command, or content is part of this harness.

The adapter intent lane verifies that caller-selected normative sources are copied
with repository-relative paths and SHA-256 into one provider-neutral payload. The
caller summary is orientation only; both voices receive the complete selected
source bytes and cannot silently choose a different plan or spec.

The CLI wrapper lane also proves the mutation snapshot uses Git tracked state/diff
plus untracked path metadata and never opens unrelated untracked file contents.

```bash
uv run --no-project python eval/wayne-code-review/check_intent_payload.py \
  wayne-code-review
uv run --no-project python eval/wayne-code-review/check_cli_wrapper.py \
  wayne-code-review
```
