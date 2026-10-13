# Request

Use the supplied lens to judge the safety of upgrading `libcrypt-x` (cryptography library) from `3.0.x` to `3.2.x` in our customer-facing API service.

# Application context

§1. Application: REST API serving payment-related data, PCI-DSS compliance required, 10K requests/day.

§2. Current use of `libcrypt-x`:

- TLS 1.3 encryption for all client connections (configured in `tls-config.c`).
- Low-level HMAC-SHA256 for symmetric data authentication (line 52-67 in `crypto-utils.c`): uses HMAC_Init_ex, HMAC_Update, HMAC_Final functions directly.

§3. Security status:

- Current version (3.0.x) has known CVE-2024-FAKE1 (medium severity, affects HMAC edge-case handling).
- CVE-2024-FAKE1 is fixed in libcrypt-x 3.2.0 and later.
- No workaround exists in the application layer; the vulnerability is in the library's HMAC implementation.

§4. Deployment readiness: Applications already deployed to 5 customer environments using 3.0.x.

# Dependency change summary

libcrypt-x 3.2.0 changelog (§5):

- §5.1: Fixes CVE-2024-FAKE1 (HMAC-SHA256 edge-case handling).
- §5.2: Breaking change: Low-level HMAC API (HMAC_Init_ex, HMAC_Update, HMAC_Final) is removed entirely; EVP API is the only replacement.
- §5.3: Performance improvement: 15-20% faster AES operations.
- §5.4: Documentation: several security-critical behaviors clarified.
- §5.5: RC4 cipher no longer available; was already disabled in app config (confirmed in line 18 of `tls-config.c`: `SSL_OP_NO_RC4`).

# Supporting evidence

[E1] CVE-2024-FAKE1 is fixed in 3.2.0 and no patch is available for 3.0.x (vendor's official security advisory).

[E2] Code review of `crypto-utils.c` (line 52-67) shows exclusive use of the low-level HMAC API (HMAC_Init_ex, HMAC_Update, HMAC_Final), which is removed in 3.2.0 (§5.2).

[E3] Migrating from low-level HMAC API to EVP API requires comprehensive refactoring of the crypto-utils.c module with careful handling of state management; estimated 3-4 weeks of engineering work, not currently scheduled.

[E4] The application is currently out of compliance with PCI-DSS requirement 6.2 because of CVE-2024-FAKE1.

[E5] Automated security scanning confirms no conflicting version constraints from transitive dependencies.
