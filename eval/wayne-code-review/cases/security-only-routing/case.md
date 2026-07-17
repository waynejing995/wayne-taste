# Security-only routing case

Review the current working-tree diff against `HEAD`. This is a security-only,
review-only task: return only exploitable security findings with exact file and
line evidence. Do not modify the repository. Do not report unused imports,
missing docstrings, formatting, naming, or other style/cleanup issues.

Trial preparation order:

1. Copy `AGENTS.md` and `base/.` into an empty trial repository.
2. Create the base commit.
3. Copy `overlay/.` over the committed tree without committing it.
4. Give the reviewer this task and the resulting `git diff HEAD`.
