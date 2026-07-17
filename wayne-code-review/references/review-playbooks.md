# Review Playbooks

Route a frozen review target to the smallest playbook set that can answer the
request. Explicit user scope wins over inferred signals. A scoped review reports
only findings owned by that scope; it does not add cleanup advice from neighboring
playbooks.

## Contents

1. Shared evidence contract
2. Routing
3. General
4. Intent and scope
5. Security
6. Dataflow and re-architecture
7. Architecture and state
8. Concurrency and reliability
9. Performance and capacity
10. Tests
11. API and migration

## Shared evidence contract

Before any review, freeze and record:

- base SHA, head SHA, and the exact diff bytes with their SHA-256;
- the approved intent, plan, spec, or acceptance criteria when available;
- the repository instructions and the user-selected review scope;
- each reviewer identity and the hash of the input it received.

Every finding must identify the changed surface, cite concrete repository evidence,
state the reachable consequence, and propose a bounded fix. Verify claims by reading
both sides of an interface, grepping callers/readers/writers, or constructing a
specific failure/interleaving. Do not file a suspicion that lacks its required
evidence. Report `NO FINDINGS` when the scoped evidence does not establish a defect.

Use exactly two severities:

- `CRITICAL`: a reachable security exploit, wrong result, data loss/corruption,
  deadlock/liveness failure, severe availability failure, or breaking compatibility
  defect that blocks the reviewed change.
- `INFORMATIONAL`: a proven defect, dead surface, bounded regression, or missing
  assurance with no demonstrated critical consequence today.

Severity follows consequence, not playbook name. Style preference alone is never a
finding. Keep each review voice's raw findings immutable; synthesis may deduplicate
or challenge them but must not invent evidence.

## Routing

| Route | Trigger signals | Decline when |
|---|---|---|
| `general` | Generic code-review request with no narrower scope and no dominant specialized signal | The user selected a specific review type; run that type only unless they requested a combined review |
| `intent-scope` | A plan, spec, acceptance criteria, issue, migration goal, or re-architecture intent exists | No normative source exists; record the absence instead of inventing intent |
| `security` | Explicit security review, or changed trust boundaries, shell/SQL execution, auth, secrets, paths, parsing, deserialization, network input, or privileged operations | The request explicitly excludes security, or no untrusted-to-sensitive path exists |
| `dataflow` | A field, config, registry entry, event, cache key, resolver, owner, producer, or consumer is added/moved/rewired | The change is local pure logic with no state seam, or endpoint evidence cannot be established |
| `architecture` | New modules, ownership, persistence, lifecycle, state machine, control plane, integration boundary, or recovery behavior | Pure local logic with no durable/shared state or architectural boundary |
| `concurrency` | Threads/tasks/processes, queues, locks, transactions, retries, timeouts, cancellation, idempotency, partial failure, or cleanup | No shared mutable state, temporal ordering, or failure/retry behavior is involved |
| `performance` | Hot loops, database access, remote I/O, batching, caching, memory growth, backpressure, fan-out, or stated scale targets | Only speculative micro-optimization is possible, with no workload or bound evidence |
| `tests` | Behavior changed, tests changed, a regression is fixed, or the request explicitly asks for test adequacy | The scoped request excludes test coverage, or no behavior/contract changed |
| `api-migration` | Public API, CLI, schema, event, config format/default, serialization, versioning, deprecation, rollout, or consumer migration changes | The surface is private and repository evidence proves there are no external or sibling consumers |

If several non-exclusive signals match, run every matching specialized playbook and
deduplicate during synthesis. `general` is the fallback, not an extra source of
generic comments. For an explicit `security-only` request, run only `security` plus
the shared evidence contract.

## General

- **Trigger:** an unscoped review request without a stronger specialized route.
- **Required evidence:** trace each claimed defect from changed code through a real
  caller or failure path; inspect error handling and boundary conditions; compare
  changed behavior with repository conventions only when the convention affects
  correctness.
- **Severity:** `CRITICAL` for reachable wrong results, corruption, exploit, or
  liveness/availability failure; `INFORMATIONAL` for a proven bounded defect or dead
  surface without current wrong behavior.
- **Decline boundary:** do not report taste, naming, formatting, speculative
  refactors, or findings owned by a narrower explicit scope.

## Intent and scope

- **Trigger:** a normative plan, spec, issue, acceptance contract, or explicit
  re-architecture outcome is available.
- **Required evidence:** map each relevant requirement to changed code and tests;
  identify planned behavior missing from the diff, unplanned behavior added by it,
  and interfaces whose implementation contradicts the approved intent. Cite the
  exact source clause and code endpoint.
- **Severity:** `CRITICAL` when required behavior is absent/wrong or an unapproved
  change alters a public contract; `INFORMATIONAL` for a real but non-blocking
  completeness or traceability gap.
- **Decline boundary:** without a normative source, do not convert assumptions into
  requirements. Report that intent comparison was unavailable.

## Security

- **Trigger:** explicit security scope or a changed trust boundary, command/query
  construction, auth decision, secret, path, parser, deserializer, network input,
  or privileged operation.
- **Required evidence:** show attacker-controlled or insufficiently trusted input,
  the complete path to a sensitive sink, the missing/incorrect validation or
  authorization boundary, and the concrete exploit consequence. For command or SQL
  injection, cite the construction and execution sites and prove whether arguments
  cross a shell/query parser boundary.
- **Severity:** `CRITICAL` for a reachable exploit, authorization bypass, secret
  exposure, arbitrary command/query execution, or security-relevant corruption.
  Use `INFORMATIONAL` only for a concrete defense gap with a reachable boundary but
  no demonstrated exploit under current constraints.
- **Decline boundary:** in `security-only` mode, do not report unused imports,
  missing docstrings, formatting, naming, documentation, performance, test coverage,
  maintainability, or generic hardening. A safe argv call without a shell is not
  command injection merely because an argument contains user text.

## Dataflow and re-architecture

- **Trigger:** state or configuration is added, moved, renamed, re-owned, resolved
  through a new seam, or consumed through a changed path.
- **Required evidence:** name and cite the producer and every relevant consumer;
  grep readers/writers and sibling consumers; compare defaults, units, enum values,
  identity/tenant context, and old/new ownership; use the frozen intent for a
  re-architecture.
- **Finding classes:**
  - **Orphan producer:** state is written/declared/registered but no consumer reads it.
  - **Dead consumer:** a consumer reads or dispatches on state no producer can populate.
  - **Semantic drift:** producer and consumer encode the same state differently.
  - **Dual path:** one consumer bypasses the canonical resolver/owner and reads a
    second source for the same state.
  - **Half migration:** the new seam exists but an old producer/consumer remains live,
    so the intended re-architecture does not control the full path.
- **Severity:** `CRITICAL` when a real consumer receives a wrong value or a half
  migration preserves the production bug; `INFORMATIONAL` for proven orphan/dead
  surface with no wrong-result path today.
- **Decline boundary:** no endpoint proof means no dataflow finding. Do not call a
  local unused variable an orphan producer or infer consumers from names alone.

## Architecture and state

- **Trigger:** ownership, module boundaries, lifecycle, persistent state, state
  machines, control planes, integration topology, observability, recovery, or
  rollback behavior changes.
- **Required evidence:** identify the single owner for each state, all mutation
  paths, state transitions and invalid transitions, failure recovery, observability,
  rollback, and the callers affected by the boundary. Show any competing source of
  truth or open-loop action without verification.
- **Severity:** `CRITICAL` for multiple live writers that can diverge, unsafe or
  unrecoverable lifecycle transitions, or a boundary error causing wrong system
  behavior; `INFORMATIONAL` for proven redundant/dead structure without current
  behavioral impact.
- **Decline boundary:** skip for a small pure function or local bug fix with no
  durable/shared state or integration boundary.

## Concurrency and reliability

- **Trigger:** concurrent execution, shared mutation, queues, locks, transactions,
  retries, timeout/cancellation, idempotency, partial failure, or resource cleanup.
- **Required evidence:** write a concrete event interleaving or failure timeline;
  identify the shared state and atomicity boundary; trace retry ownership,
  idempotency key/effect, timeout/cancellation propagation, and cleanup after every
  terminal path.
- **Severity:** `CRITICAL` for a reachable race, lost update, duplicate effect,
  deadlock, unbounded retry, silent failure, or leaked critical resource;
  `INFORMATIONAL` for a bounded, evidenced reliability weakness without current
  correctness or availability loss.
- **Decline boundary:** no shared state, temporal dependency, or failure path means
  no concurrency/reliability finding. Do not report a hypothetical race without an
  interleaving.

## Performance and capacity

- **Trigger:** changed complexity, hot-path work, database/query pattern, remote
  calls, batching, fan-out, caching, memory retention, backpressure, or capacity
  assumptions.
- **Required evidence:** identify the real workload and bound; count queries/I/O,
  derive complexity, or cite a benchmark/profile; show allocation/retention,
  queue/backpressure behavior, or amplification per request.
- **Severity:** `CRITICAL` for reachable exhaustion, unbounded growth/fan-out, or a
  regression that breaks a stated production capacity/SLO; `INFORMATIONAL` for a
  measurable bounded regression with no critical consequence.
- **Decline boundary:** no micro-optimization advice without scale evidence. Skip
  this playbook entirely in `security-only` mode.

## Tests

- **Trigger:** production behavior or tests changed, a regression was fixed, or the
  review explicitly asks whether verification is adequate.
- **Required evidence:** map changed requirements, branches, failure paths, and
  boundaries to concrete assertions; prove the test reaches the changed code and
  would fail against the faulty behavior; inspect fixtures/mocks for false-green
  substitution.
- **Severity:** `CRITICAL` when a false-green or missing gate allows a known critical
  defect/contract break to pass; `INFORMATIONAL` for a specific missing regression,
  edge, or error-path test without demonstrated production failure.
- **Decline boundary:** do not demand tests for formatting or implementation detail,
  and do not report test coverage in `security-only` mode.

## API and migration

- **Trigger:** public or cross-component API, schema, event, CLI, configuration,
  serialization, default, version, deprecation, or rollout changes.
- **Required evidence:** enumerate producers and consumers; compare old/new shapes,
  defaults, units, and version negotiation; verify backward/forward compatibility,
  migration ordering, mixed-version behavior, rollback, and data preservation.
- **Severity:** `CRITICAL` for a reachable consumer break, incompatible mixed-version
  state, irreversible data loss, or rollout/rollback trap; `INFORMATIONAL` for a
  concrete migration/deprecation gap not yet breaking a live consumer.
- **Decline boundary:** skip when the surface is private and call-site evidence proves
  every consumer changes atomically. Do not infer public usage from a function name.
