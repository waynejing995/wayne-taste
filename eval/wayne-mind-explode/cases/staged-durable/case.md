# Design request: delivery retry discovery

Begin converging bounded retry behavior for transient delivery failures. The
repository and these approved constraints already answer the first branches:

- only timeouts and HTTP 429/503 are retryable;
- three total attempts are allowed;
- `Dispatcher` remains the only lifecycle owner;
- retry state is in memory and may be lost on restart;
- implementation and planning are out of scope.

The next user choice after these facts is whether response headers may override the
backoff schedule. Do not infer that choice.
