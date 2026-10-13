# Request

Use the supplied lens to judge the safety of upgrading `pg-query-native` from `v0.13` to `v0.14` in our application.

# Application context

§1. Application: PostgreSQL query parser service, production, 50K requests/day.

§2. Current use of `pg-query-native`:

- Parses SQL statements to extract table names (line 42-47 in `parser.js`).
- Never calls deprecated features listed in v0.14 changelog.
- Fallback: if parse fails, logs and uses a regex fallback (line 98-110).

§3. Release timeline: no urgency, can test in staging for 2 weeks first.

# Dependency change summary

v0.14 release notes (§4):

- §4.1: Minor performance improvement to JSON output serialization.
- §4.2: Fixes issue #412 (incorrect handling of SQL comments in CTEs).
- §4.3: Adds support for PostgreSQL 17 syntax (new in v0.14, no app impact).
- §4.4: No breaking changes listed.
- §4.5: All current v0.13 tests pass with v0.14 code.

# Supporting evidence

[E1] Our test suite runs 2000 SQL parse operations; all pass with v0.14 in staging.

[E2] The application does not use CTEs (common table expressions); no exposure to §4.2 fix.

[E3] No deprecation warnings in the build log when running with v0.14 on our dependency tree.
