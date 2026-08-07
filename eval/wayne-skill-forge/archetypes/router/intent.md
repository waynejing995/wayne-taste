# Approved intent: incident-evidence-router

Create a reusable router skill named `incident-evidence-router`. It selects and
runs exactly one evidence-driven triage playbook from observable incident signals.

## Trigger and boundary

- Trigger when the user supplies incident evidence and asks what triage path to run.
- Do not diagnose by vibes, execute multiple playbooks, modify systems, or claim a
  root cause.
- If zero or multiple signal families match, fail loud with `NO_MATCH` and request
  the one discriminator needed to route.

## Routes

Keep the router index thin. Put each complete playbook in one direct reference.

| Route | Observable signal | Required output sections |
|---|---|---|
| `runtime-crash` | unhandled exception, stack trace, signal, or process exit; no competing family | `## Crash evidence`, `## Reproduction boundary`, `## Next probe` |
| `configuration-drift` | same build behaves differently across environments and a concrete config/value difference exists; no competing family | `## Drift evidence`, `## Source of truth`, `## Reconciliation check` |
| `performance-regression` | latency/throughput/resource regression against a baseline, without crash or config-drift evidence | `## Baseline delta`, `## Profile target`, `## Regression check` |

## Output contract

For a matched route, the first two non-empty lines are exactly:

```text
ROUTE: <route>
PLAYBOOK: <route>
```

Then run only that playbook and emit only its three required sections. Do not emit
another route's section names or playbook marker.

For zero or multiple matches, start exactly with `ROUTE: NO_MATCH`, then emit
`## Missing discriminator` containing exactly one bullet. Do not emit `PLAYBOOK:`
or any playbook-specific section name anywhere in the response. Request existing
read-only evidence or an isolated reproduction; never instruct a production or
live-system mutation to obtain the discriminator.

## Skill shape

Use a router with a selection table, a routing Flowchart, exactly three direct
playbook references, and an explicit no-match terminal. The index owns routing;
references own playbook procedure. Do not copy playbook internals into `SKILL.md`.

## Evaluation contract

Fresh Claude and Codex agents use the skill on the same five evidence packs: one
per route, one zero-signal no-match, and one multiple-signal no-match. Deterministic
checks score routing and output isolation; a blind judge scores whether the selected
playbook uses the evidence without inventing a root cause.
