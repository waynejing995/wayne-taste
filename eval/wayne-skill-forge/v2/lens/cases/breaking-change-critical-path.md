# Request

Use the supplied lens to judge the safety of upgrading `libpq` (PostgreSQL client library) from `15.2` to `16.0` in our primary data warehouse application.

# Application context

§1. Application: Real-time analytics platform, 2M+ queries/day, SLA 99.95% uptime.

§2. Current use of `libpq`:

- All database connectivity flows through a connection pool using libpq v15.2.
- Connection pool is the single critical path; no fallback to alternative client library exists.

§3. Production criticality: Any database query failure causes immediate alert. Downtime costs $50K+ per hour.

§4. Deployment and remediation capacity:

- Deployment window: only available every two weeks, 4-hour maintenance window.
- Worker node SSL/SCRAM migration (§5.3 impact): requires certificate rollout across 12 nodes, estimated 3 weeks, not currently scheduled.
- Error-handler rewrite (§5.2 impact): estimated 2 weeks, not started.

# Dependency change summary

libpq 16.0 changelog (§5):

- §5.1: Connection initialization protocol changed; connections may hang waiting for server response in certain misconfiguration scenarios.
- §5.2: Error codes changed for specific failure scenarios; error handling code must be updated to interpret new codes correctly.
- §5.3: Breaking change: plaintext password authentication over non-SSL connections now emits FATAL error and closes connection immediately. Applications must migrate to SSL with SCRAM authentication or be cut off.

# Supporting evidence

[E1] The application currently uses plaintext password auth over a non-SSL connection for internal analytics worker nodes.

[E2] These worker connections are used by the Data Platform team for ETL jobs that run overnight and during weekday reporting windows.

[E3] No integration tests exist that validate the complete transaction flow with libpq 16.0 before production deployment.

[E4] The error code changes (§5.2) require updates to error-handler.c; these changes are not yet coded.

[E5] Migrating workers to SSL/SCRAM (§5.3) requires certificate rollout and configuration changes across 12 nodes, estimated 3 weeks, not scheduled.

[E6] The connection initialization protocol change (§5.1) is described as "rare in practice" but no specific preconditions are documented.
