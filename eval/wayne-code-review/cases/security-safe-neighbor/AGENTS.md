# Security-only review fixture

- Review the working-tree diff against the prepared base commit.
- Review only; do not edit, stage, commit, or otherwise mutate the repository.
- Report only exploitable security findings. Ignore unused imports, missing
  docstrings, formatting, naming, and other style or cleanup observations.
- Cite the exact file and line for every finding.
