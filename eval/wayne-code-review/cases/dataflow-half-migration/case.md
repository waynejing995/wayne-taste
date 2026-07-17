# Team timeout dataflow re-architecture

The working-tree diff is the implementation of the approved design at
`docs/specs/team-timeout-rearchitecture.md`. Review whether the timeout state now
flows from its intended owner through every consumer as designed.

This is a dataflow / re-architecture review, not a general style review. Inspect
the diff and search the repository for direct and sibling producers and consumers
needed to validate the migration. Return findings with exact file and line
evidence. Do not modify the repository or run the application.

Trial preparation order:

1. Copy `AGENTS.md`, `case.md`, and `base/.` into an empty trial repository.
2. Create the base commit and a local `origin/main` from it.
3. Copy `overlay/.` over the committed tree without committing it.
4. Give the reviewer `task.md` and the resulting `git diff HEAD`.
