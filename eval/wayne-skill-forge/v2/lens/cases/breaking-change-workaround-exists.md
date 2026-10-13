# Request

Use the supplied lens to judge the safety of upgrading `axios` from `v0.26` to `v1.4` in our Node.js backend service.

# Application context

§1. Application: Internal admin API, moderate traffic, ~100 requests/min in business hours.

§2. Current use of `axios`:

- Makes HTTP requests to three internal microservices (auth service, metrics service, reporting service).
- Uses axios interceptors to add auth headers (line 15-22 in `http-client.js`).
- The interceptor code calls `axios.interceptors.request.use(addAuthHeader, onError)` with two arguments: a handler and an error callback.

§3. Application's error handling:

- If an interceptor throws or rejects, the error callback at line 17-20 catches it and passes control to the fallback at line 24-28.
- The fallback retries the request with an auth token that provides equivalent credentials to the original header.
- This error path is already proven in production: execution logs show it was called 47 times in the last 3 months.
- Staging tests with v1.4 confirm that the breaking API change causes the interceptor to throw, which triggers the error callback and fallback at line 24-28 (test run: staging-20261001, all 100 interceptor tests passed with fallback activation).

§4. Testing readiness: staging environment available; can test for 1 week before production.

# Dependency change summary

axios v1.4 changelog (§5):

- §5.1: Interceptor API changed; handlers that read a second parameter now throw an error (the v0.26 behavior of passing a second param is no longer supported). The error callback (onError) is still registered and will catch this error.
- §5.2: Response compression auto-handling removed (now requires manual decompression if enabled).
- §5.3: Improves error messages for network timeouts.

# Supporting evidence

[E1] The interceptor at line 15-22 in http-client.js uses both arguments: the addAuthHeader handler and the onError error callback. The addAuthHeader handler at line 16 reads its second parameter, so on v1.4 it will throw an error, triggering the error path.

[E2] The app does not enable response compression in axios config; search of codebase finds 0 matches for "compress".

[E3] The fallback auth token at line 24-28 provides credentials equivalent to the original header and has been used 47 times in production.

[E4] Staging test with v1.4 confirms the error callback at line 17-20 is invoked, activating the fallback at line 24-28.
