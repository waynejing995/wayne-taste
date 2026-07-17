# Team-owned timeout re-architecture

Status: approved

## Intent

Move delivery timeout ownership out of the shared core constant and into
`TeamConfig.timeout_ms`. Different teams must be able to select different timeout
values without changing shared code.

## Dataflow contract

1. `TeamConfig.timeout_ms` is the single runtime owner of the selected timeout.
2. `DEFAULT_TIMEOUT_MS` may remain only as the construction default for
   `TeamConfig`; runtime consumers must not read it directly.
3. `resolve_timeout(config)` is the only consumer-facing seam for the selected
   value and returns `config.timeout_ms` after validating that it is positive.
4. Both `primary_timeout(config)` and `retry_timeout(config)` must obtain their
   value through `resolve_timeout(config)`.
5. A second team configured with `timeout_ms=2400` must receive `2400` on both the
   primary delivery and retry paths. Returning the shared default on either path
   is a wrong-value production bug, not dead code.

## Review boundary

This design changes timeout state ownership and its producer/consumer path. Static
review must inspect sibling consumers even when a consumer file is absent from the
diff. Runtime verification remains a later pipeline stage.
