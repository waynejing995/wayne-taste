# Request

We want your judgment on upgrading `lodash` from `4.17` to `5.0` in our backend API service. We also want to know if the Data Platform team should upgrade too.

## Part A: Backend API service

### Application context

§1. Application: Backend API service, production, 5K requests/day, owned by the Payments team.

§2. Current use of lodash:

- Uses `_.pick` and `_.omit` for request field filtering (line 42-48 in request-mapper.js).
- Does not use `_.reduce`, `_.debounce`, or `_.throttle`.

§3. Dependency management:

- The Payments service maintains its own lodash version constraint in package.json, independent of other monorepo packages.

§4. Testing readiness: Staging environment available; can test immediately.

### Dependency change summary

§5. lodash 5.0 changelog:

- §5.1: `_.pick` and `_.omit` unchanged (backward compatible).
- §5.2: `_.reduce` falsy-handling changed (not used by this service).
- §5.3: `_.debounce` and `_.throttle` API simplified (not used by this service).

### Supporting evidence

[E1] Code search: 0 matches for _.reduce, _.debounce, _.throttle in the Payments service codebase.

[E2] The two functions used (_.pick, _.omit) are listed as unchanged in §5.1.

[E3] The Payments service declares its own lodash version in package.json; upgrades are independent of other teams' choices.

## Part B: Data Platform team evaluation

The Data Platform team uses _.reduce with falsy initial values (behavior changes in §5.2) in their aggregation pipeline, which runs overnight and during reporting windows. Should that team upgrade to lodash 5.0?
