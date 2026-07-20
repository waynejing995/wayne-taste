# Failure evidence: decision DAG exits early

Raw user corrections, 2026-07-20:

> something is wrong, the mindexplode losing the intent of iterate the dag tree,
> just escape really early

> so in normal cases i may have over 40 decision to make

> and does the automatically discovered fact get confirmed necessary or just let
> agent do it?

Causal mechanism: the current decision log owns resolved rows but has no durable
owner for open/blocked DAG nodes. Flow node `C` therefore evaluates “unresolved?”
from transient model memory, allowing one answer or a long log to be mistaken for
convergence.

Frozen oracle:

- facts with codebase/constraint evidence auto-resolve without a confirmation turn;
- choices require one recommended user question;
- resolving a choice persists newly opened child nodes before the next turn;
- convergence is legal only when the durable frontier is empty;
- forty resolved decisions plus one open node is still unresolved.
