# Tracker item GH-42

Category candidate: enhancement. The full issue is quoted here; do not fetch it.

Add a public retry-policy object to `DispatcherConfig`, expose it through both CLI
and worker entrypoints, and preserve the default one-attempt behavior. Acceptance:
callers can configure bounded attempts and backoff through the same exported config;
CLI and worker consume one shared representation; invalid values fail at startup.

This changes a public config contract used by more than one consumer. There is no
bug to reproduce. Recommend tracker category/state and the Wayne route, but do not
modify `tracker-state.json` or implement the enhancement.

Handoff approval: granted for one return-only internal Wayne packet.
