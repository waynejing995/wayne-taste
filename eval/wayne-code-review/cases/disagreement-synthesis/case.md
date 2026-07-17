# Disagreement synthesis case

Two independent reviewers inspected the same frozen patch. They agree on one
security finding and disagree on one compatibility judgment:

- both report `shell-command-injection` as `CRITICAL`;
- Claude reports `overwrite-default-compatibility` as `CRITICAL`;
- Codex explicitly records `overwrite-default-compatibility` as `NOT_A_FINDING`.

The task is to synthesize the supplied raw reports without rerunning review,
resolving the judgment dispute, changing confidence, or modifying any file.
