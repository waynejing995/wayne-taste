# Gemini briefs and model selector

Load this reference before dispatching the Gemini subagent in Node C (Proposal B) or Node R (interaction and copy review).

## Model selector rule

Pass the exact model selector in the `task` call's `model` parameter. Never pass a role name, because roles can carry `retry.fallbackChains` that fall back to Opus.

- Every host: the selector listed for that host in `~/.wayne/CONTEXT.md`

Keep the Gemini subagent read-only (no repository edits). If the Gemini call fails, report the failure to Wayne and ask. Never rerun it on another model, never use Opus, and never continue with only one proposal.

## Proposal B brief (Node C)

### What goes in

- Wayne's verbatim words, with where and when he said them
- The Pain statement (observable symptom today, no solution words)
- Pointers to settled facts (`$STATE/runs/<topic>/decision-log.jsonl`, `$STATE/runs/<topic>/context.md`) and the relevant code paths or symbols
- Output target (`$STATE/runs/<topic>/proposal-b.md`, or return-only markdown for the main model to save)

### What must never go in

- Proposal A's draft, outline, conclusions, or architecture preference
- Leading hints about which option the main model favors
- Permission to edit repository files

### Output shape

- Scope and non-goals
- Components and ownership
- Data and state ownership
- Interfaces and boundaries
- Failure behavior and rollback
- Verification plan
- Any unverified inference labeled `[guess]` so Node D checks it against code, logs, or production data before adoption

### Brief skeleton

```text
Pain:
<Pain statement, no solution words>

Wayne's verbatim request (<where>, <when>):
"<verbatim words>"

Pointers (read-only; do not edit repository files):
- Context & settled facts: <$STATE/runs/<topic>/context.md>, <$STATE/runs/<topic>/decision-log.jsonl>
- Relevant code/docs: <repo-relative paths and symbols>

Task:
Independently design a complete solution from Wayne's words, the Pain, and the inspected facts.
Cover:
1. Scope and non-goals
2. Components and ownership
3. Data and state ownership
4. Interfaces
5. Failure behavior and rollback
6. Verification

Rules:
- Read only what you need from the pointers above; do not edit repository files.
- Label any unverified assumption or inference with [guess].
- Return the complete proposal directly (or write only to <$STATE/runs/<topic>/proposal-b.md> if writable).
```

## Interaction and copy review brief (Node R)

Run Node R only after the main model has drafted its own interaction and copy and applied Wayne's UI rule (no second label or description on a component). Skip Node R for a copy fix of a few words.

### What goes in

- Who the page or surface is for (target user)
- What the user must get done (primary job and flow)
- The main model's current interaction and copy draft (states, controls, feedback, error/empty states, exact strings)
- Screenshot paths, if any

### What must never go in

- Permission to edit repository files
- Internal implementation jargon meant for engineers rather than end users

### Output shape

- Numbered suggestions grouped by: flow/interaction, states/feedback, exact copy replacements (`current` -> `suggested` + reason), and any redundant secondary label or description that violates Wayne's UI rule.
- Node D/R verification rule: check every suggestion against how the feature actually works; adopt it or reject it with a reason, and reject unkept product promises or invented domain wording. Record all resolutions in `$STATE/runs/<topic>/fusion.md`.

### Brief skeleton

```text
Who this page is for:
<target user and context>

What the user must get done:
<primary user goal and key tasks>

Current interaction and copy draft:
<states, transitions, controls, feedback messages, and exact UI copy>

Screenshots (if any):
<paths, or none>

Task:
Review this interaction and copy as a UX/copy consultant.
Flag:
1. Confusing flow steps, missing states, or unclear feedback
2. Non-human, overly wordy, or engineer-jargon copy, with concrete `current -> suggested` replacements
3. Any second label or description on a component (Wayne's UI rule forbids extra secondary labels/descriptions)

Rules:
- Read-only; do not invent product capabilities or promises not present in the draft.
- Return numbered findings and exact replacement wording.
```
