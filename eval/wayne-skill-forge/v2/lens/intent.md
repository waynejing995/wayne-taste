# Approved intent: dependency-upgrade-risk-lens

Create a reusable lens skill named `dependency-upgrade-risk-lens`. It judges whether upgrading a dependency version introduces unacceptable risk in a specific application context, distinguishing between risk tolerated for capability gain and risk that should block an upgrade. This is a judgment skill requiring contextual reasoning: the same technical change carries different risk depending on scope, fallback, and application criticality.

## Trigger and boundary

- Trigger when the user asks whether a specific version bump of a dependency is safe to adopt, given application constraints and dependency change details.
- Decline when the request is purely technical (e.g., "list breaking changes in X") or when it lacks application context (what does the application use the dependency for?).
- Decline when the user requests you to decide for other teams' applications or when you are asked to evaluate dependency compatibility in a monorepo holistically.

## Judgment principles

- Focus on the application's actual use of the dependency, not the dependency's full surface.
- Separate the technical change (what changed) from the application impact (does it matter to this app).
- A breaking change to a rarely-used feature in a dependency is lower risk than an enhancement to a frequently-used one if the application does not use that feature.
- Tolerate breaking changes when they unlock critical capability, unblock a security fix, or resolve a known pain point in the current version.
- Do not assume workarounds are easy or always feasible; distinguish between "possible to work around" and "the app is already working around it with low cost".
- Classify risk as: acceptable, acceptable-with-precautions, or unacceptable. Provide the qualifying condition for each.
- When the same change creates risk in one code path and not another (e.g., error handling vs normal flow), name the risk scenario explicitly.

Risk classes are defined precisely:

- **ACCEPTABLE**: Nothing the application uses is removed, changed in a breaking way, or requires new configuration. All used APIs remain backward-compatible.
- **ACCEPTABLE-WITH-PRECAUTIONS**: An application-used code path breaks, AND at least one of these holds: (a) an existing low-cost workaround is already deployed in production; (b) a low-cost (<8 hours), feasible code or configuration fix is identified; or (c) a tolerated exception applies (security fix unblocks it, critical capability unlocked, or known pain point resolved). A precaution must state the required step or validation.
- **UNACCEPTABLE**: An application-used code path breaks, and none of (a)-(c) holds.

## Output contract

The first non-empty line is exactly one of:

- `VERDICT: ACCEPTABLE`
- `VERDICT: ACCEPTABLE-WITH-PRECAUTIONS`
- `VERDICT: UNACCEPTABLE`
- `VERDICT: DECLINE`

For an upgrade verdict, use these exact sections in order:

1. `## Application use`
2. `## Change summary`
3. `## Impact scenarios`
4. `## Risk classification`
5. `## Precautions` (omitted only if verdict is ACCEPTABLE and no precautions exist)

For `DECLINE`, return the verdict plus at least one concise reason line, do not simulate the five-section review, and do not provide the upgrade recommendation itself.

For a mixed request (in-scope part plus out-of-scope part): provide an upgrade verdict for the in-scope application only, then add exactly one sentence declining the out-of-scope part and naming why it is outside this skill's boundary.

Each section must be non-empty. Every evidence reference must cite an exact section or line number from the provided input (e.g., `§2.1` or `line 15`); do not invent references or re-state an observation as inferred risk. For each Impact scenario bullet, state the condition clearly (e.g., "if the application calls X" or "when Y is true"), followed by the consequence.

Deterministic checks enforce only this structural/evidence floor; a blind judge owns semantic reasoning quality.

## Skill shape

Use a lens with an applicability boundary, principles that distinguish acceptable from unacceptable risk given context, and contrasting cases: a straightforward upgrade, a breaking change the application already works around, a breaking change in a critical path, a mixed-scope upgrade with both gains and losses, and a decline case. Do not add a migration checklist, a step-by-step implementation guide, or a schema template; reasoning quality is judged behaviorally.

## Evaluation contract

Fresh Claude and Codex agents use the skill on six to eight real upgrade scenarios: a straightforward safe upgrade, an upgrade with a tolerated breaking change (application already works around it), a breaking change in a critical path, an upgrade that unblocks a security fix, a mixed-scope upgrade (both breaking changes and capability gains), at least one partial-decline case (mixed in-scope and out-of-scope), and at least one clear decline (no application context). A blind judge scores evidence grounding, calibration of risk classification, scenario specificity, reasoning about feasibility of workarounds, and decline discipline.
