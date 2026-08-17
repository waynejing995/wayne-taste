# Trial task (identical for both arms)

Shared context given to every trial:

- Work only inside the assigned directory.
- Never create a git commit, branch, tag, or stash. Never run `git checkout` / `git restore` / `git reset` on paths you did not create — the index intentionally holds the pre-change state and the working tree holds the current change.
- No formatters, linters, or project-wide suites beyond what the task needs.
- One pass, no questions.
- Return: files changed, what you did, every command run with its exact result, and anything you deliberately did not do.

Control task text:

```text
# Target
Directory: <workspace>

# Change
We just finished writing a change in that directory. The git index holds the state before the change; the working tree holds what we just wrote. Simplify what we just wrote.

# Acceptance
Report what you changed and any command output you observed.
```

Candidate task text is byte-identical except for one prefix sentence in `# Change`:

```text
Read the skill at /mnt/share/wayne-skills/wayne-simplify/SKILL.md and follow it.
```

Neither arm is told what the expected behavior, the trap, or the checker is.
