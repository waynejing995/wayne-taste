# Approved intent: observability-incident-router

Create a reusable router skill named `observability-incident-router`. It selects and runs exactly one specialized incident investigation playbook from observable signals in a monitoring alert or incident report.

## Trigger and boundary

- Trigger when the user supplies incident evidence (logs, metrics, alerts, traces, or system state snapshots) and asks what investigation path to run.
- Do not diagnose by heuristics, execute multiple playbooks, or modify systems.
- Return `NO_MATCH` and request one read-only discriminator when routing is ambiguous or impossible.

## Signal definitions

A strong signal is independently observable and directly indicates one route. A weak signal is contextual only.

| Route | Strong signal definition (required) | Weak signal (context only) |
| --- | --- | --- |
| `latency-trace` | p95 or p99 latency degradation exceeds 50% above baseline, or SLO breach confirmed within alert window | business metric affected; slow traces observed |
| `resource-saturation` | memory utilization >85%, or CPU throttling detected, or disk free space <10% of capacity; **observed during anomaly** | request latency elevated; error rate above baseline |
| `error-spike` | error rate ≥2x baseline within time window, confirmed by log pattern (not system restart) **and memory utilization <85%** | latency elevated; error type consistent |
| `deployment-rollout` | application version change, configuration deployment, or database schema change **occurred within 5 minutes before incident start** | latency or error rate elevated; resource consumption normal |

## Routing algorithm

First check for incompatible strong-signal pairs. Then check for zero signals. Then apply winning rules. Deployment-rollout may co-occur with other strong signals without blocking them.

**Step 1: Incompatible pairs (any → NO_MATCH)**

- If both `latency-trace` and `error-spike` strong signals are true: return `NO_MATCH`.
- If both `resource-saturation` and `error-spike` strong signals are true: return `NO_MATCH`.
- If both `resource-saturation` and `latency-trace` strong signals are true: return `NO_MATCH`.

**Step 2: Zero signals**

- If no strong signals are true: return `NO_MATCH`.

**Step 3: Winning rules (first true wins; deployment-rollout co-occurrence does not block)**

1. If `resource-saturation` strong signal is true, run `resource-saturation`.
2. Else if `latency-trace` strong signal is true, run `latency-trace`.
3. Else if `error-spike` strong signal is true, run `error-spike`.
4. Else if `deployment-rollout` strong signal is true, run `deployment-rollout`.

## Output contract

For a matched route, the first two non-empty lines are exactly:

```text
ROUTE: <route>
PLAYBOOK: <route>
```

Then run only that playbook and emit only its three required sections in order. Do not emit another playbook's section names or markers anywhere in the response.

For `NO_MATCH`, start exactly with `ROUTE: NO_MATCH`, then emit `## Missing discriminator` containing exactly one bullet. Do not emit `PLAYBOOK:` or any playbook-specific section name anywhere. Request existing read-only evidence (a metric value, log query result, or deployment timestamp); never instruct a production mutation.

| Route | Required output sections |
| --- | --- |
| `latency-trace` | `## Latency evidence`, `## Baseline SLO`, `## Trace target` |
| `resource-saturation` | `## Resource snapshot`, `## Saturation cause`, `## Remediation check` |
| `error-spike` | `## Error evidence`, `## Log pattern`, `## Regression check` |
| `deployment-rollout` | `## Change evidence`, `## Rollout scope`, `## Rollback plan` |

## Skill shape

Use a router with a signal table, a decision flowchart, exactly four direct playbook references, and an explicit no-match terminal. The index owns routing logic; references own playbook procedure. Do not copy playbook internals into `SKILL.md`.

## Evaluation contract

Fresh Claude and Codex agents use the skill on the same 8 evidence packs: resource-saturation alone, resource-saturation + deployment-rollout co-occurrence, latency-trace + deployment-rollout co-occurrence, error-spike alone, deployment-rollout alone, latency-trace with weak signals only and memory-pressure near-synonym (should be NO_MATCH), zero-signal, and latency-trace + error-spike co-occurrence (forbidden pair; Step 1 → NO_MATCH). Deterministic checks score routing and output isolation; a blind judge scores whether the selected playbook uses evidence appropriately.
