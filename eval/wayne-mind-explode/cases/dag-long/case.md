# Design continuation: long queued-delivery DAG

This is a normal large design with more than forty dependency-ordered decisions.
Forty decisions are already resolved in the durable log. Decision N41 is pending;
its answer opens N42. A long history is not convergence: continue until the durable
frontier is empty, one reachable choice per user turn.
