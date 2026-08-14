# Scout fan-out contract

Load this when the repository is large enough that reading it serially would exhaust context before the report exists — roughly, more than a few dozen source files or more than one subsystem.

## Choosing axes

One scout per axis that can be read without waiting for another axis. Four axes cover most repositories:

| Axis | Reads | Answers |
| --- | --- | --- |
| Documented architecture | `docs/`, root `README`, `AGENTS.md`/`CLAUDE.md`, architecture pages | What does the project claim about itself? |
| Runtime internals | the core loop, state store, execution pipeline, error paths | What does the code actually do? |
| Extension surface | plugin/registry/adapter packages, public SDK, protocol bridges | How does a third party add behaviour? |
| Toolchain and background | build, lint, test, CI, release, governance files, history | How is it kept honest, and by whom? |

Add a fifth only when the repository has a genuinely separate half, such as a browser client or a native launcher.

Dispatch all axes in one batch. Serialising them buys nothing and costs a full round trip each.

## Shared context every scout receives

State once, for the whole batch:

- the repository path and the exact snapshot (`HEAD` SHA, date, version);
- the decision the report serves;
- facts already established, so scouts do not re-derive them;
- that the work is read-only: no writes, no installs, no builds, no test runs;
- that the parent will re-grep every citation, and anything that fails is deleted and attributed as an error.

## Evidence contract every scout receives

Paste this verbatim into each task:

> - Quote **exact bytes**. Never put a cleaned-up paraphrase inside quotation marks.
> - Give `path:line` for every claim. If the line is uncertain, give the path plus a short unique literal I can grep.
> - Tag anything you reasoned rather than read with `[INFERENCE]`.
> - If something you expected to find is absent, write a `NOT FOUND` line rather than omitting it.
> - Never report a count taken from truncated output. Recompute it with `wc -l`, `grep -c`, or `find | wc -l`.
> - Deliver the full report as markdown in your final message, not only in a structured field.

The last line matters: a structured return schema silently drops long prose, and the prose is the deliverable.

## Reviewing what comes back

Scouts are confident and sometimes wrong. Before a scout claim enters the report:

- re-check the one or two claims each conclusion rests on;
- recompute every number, because truncated tool output produces confident wrong counts;
- reject any quotation whose bytes you have not seen.

When a scout self-corrects, keep both versions in the working notes. The correction is evidence about how the finding was reached, and it belongs in the report's corrections table.

A scout that returns a structured summary without prose has not failed — its transcript still holds the report. Recover it rather than re-running the work.
