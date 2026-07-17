# Wayne Code Review eval

This harness optimizes one existing `wayne-code-review` skill from frozen history
and behavior. Generated workspaces, provider homes, traces, and candidates belong
under gitignored `eval/.runs/wayne-code-review/`.

The first target is `security-only-routing`: an explicit security-only request has
one real command-injection defect and two non-security decoys. The control must
reproduce a broad/unfocused review or another exact boundary failure before a
candidate is eligible.

No gstack-named skill, path, command, or content is part of this harness.
