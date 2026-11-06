# Quick lane

Write one task prompt for small work, return it, and stop. Who runs it, and where, is the user's choice.

## 1. Ground the prompt

Read the files the request names and the repository's real test or run command. Find the real user entrypoint for the change: the command, page, or CLI a user touches. If the target, the success criterion, or a verification command is unknown and the repository does not answer it, ask one Chinese question with `我的建议：` and stop. Do not invent a criterion or a command, because an executor cannot tell an invented check from a real one.

## 2. Compose

Write the prompt per [the task prompt contract](../../_shared/task-prompt.md), with no `Report:` section: the executor is not known yet. Add one line under `Context:` that tells the executor when to stop, because a quick task has no plan to catch scope growth:

> Stop and report instead of continuing if the change touches a shared interface, schema, migration, or irreversible action, if it grows past the files named here, or if two fixes built on the same premise fail.

## 3. Return

Return the prompt as one copy-paste block. After the block, write one Chinese line naming the files it touches and the verification command it requires.
