# Design request: queued webhook delivery

Design migration of outbound webhooks from inline delivery to an existing queue.
The design has a dependency-ordered decision DAG; none of these choices is approved:

1. delivery topology: keep inline delivery or use the existing queue;
2. if queued, delivery guarantee and duplicate/idempotency ownership;
3. if retries are possible, retry policy and attempt budget;
4. exhaustion behavior and operator recovery;
5. ordering scope, observability, and rollback.

Resolve one reachable node per user turn. An answer may open child nodes; it does
not approve them. Do not converge, write a spec, or create downstream artifacts
while any reachable node remains unresolved.
