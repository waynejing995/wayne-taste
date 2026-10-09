# Repair planning and Work integration contract

Required by nodes P, W and E of wayne-fix-review. These are caller-specific overrides to Plan's planning workflow and Work's input/return boundaries, not permission to bypass execution or change approved product behavior.

## Contents

- [Planning inputs and output](#planning-inputs-and-output)
- [Review and execution authorization](#review-and-execution-authorization)
- [Work invocation packet and ownership](#work-invocation-packet-and-ownership)
- [Repair evidence carried into units](#repair-evidence-carried-into-units)
- [Work return contract](#work-return-contract)

## Planning inputs and output

Invoke `wayne-plan` with the verified ledger, explicit human selection/exclusions, pinned source and dirty baseline, and relevant specs/decisions. Its job is to produce a durable repair plan using Plan's filename convention; return the actual file path, not only a chat summary or invocation packet. Return-only means return to Fix Review, not skip the plan file or authorize implementation.

- Use Plan's lite shape for a standalone repair: What changes, What this touches, How it is proved, Sources. Use its standard shape when a carried decision log requires it. Keep existing product obligations; never pretend they are absent to select lite mode.
- This caller replaces fixed research lanes, deepening and multi-round reviews with completed finding research and the single review below. It also bypasses a new E-ownership gate, `MISSING_E2E` and nested `wayne-test-design`. Preserve any existing matrix/E contract and its owner; if none exists, explicitly record that absence and the required local consumer-surface proof, not invented E rows or an unsupported claim that E2E is unnecessary.
- Every unit carries finding links, confirmed cause, intended before/after behavior, exact files/symbols and allowed write set, approach and repository pattern, dependencies, consumes/produces and shared interfaces, execution ownership, test authorship/locked inputs, plan-owned U scenarios, and exact RED/GREEN plus applicable surface and integration commands with expected observables. Group common causes, not comment counts. Include the shared contracts/callers the fix must migrate and explicit exclusions.
- Give each writable path one owner; make shared integration paths main-owned within Work. Missing behavior, compatibility, recovery or scope decisions remain blockers, not implementation defaults. A newly necessary unselected repair returns to the human scope gate.

The finding ledger owns truth, human selection and disposition; the plan owns unit definitions and U rows; Work owns execution/wave state and U status. Link these records rather than copying unit progress into a competing ledger. Plan returns its path and reviewed inputs without checkpoint or automatic Work dispatch.

## Review and execution authorization

Run one fresh read-only plan review with the plan, selected findings, evidence, governing constraints and relevant source. Check causal coverage, omitted callers, scope, write collisions, dependencies/interfaces and whether each proof can expose the defect. This is not a new code review. Resolve findings in the main agent; check closure without automatically repeating a full review round. A real blocker stays blocked after the round ends.

Present the reviewed plan before execution. Record the user's explicit authorization to execute that approved plan through `wayne-work`; reuse a prior grant only when it explicitly covers this plan and unchanged scope. Finding selection alone is not execution permission. A changed selection, risk or behavior requires a new human decision. The skill repository's `_shared/pipeline-id-contract.md` manual-stage rule remains unchanged: neither a review pass nor an approved status triggers Work; the user's execution request does.

## Work invocation packet and ownership

Read and invoke `wayne-work`; do not implement its instructions from memory or merely name it in a status update. Supply:

- the durable approved plan path and its review/adjudication record;
- finding-to-unit links, causal evidence, selected/excluded scope and the user's execution grant;
- current checkout and preserved dirty baseline, source contracts and any authoritative matrix path;
- the per-unit proof obligations below, integration commands and this scoped return contract.

**Work input override:** its completeness checks require every applicable carried source, not fabricated spec/decision/matrix documents. When no formal E contract was carried, the explicit absence and local surface proof in this repair plan replace the E-table prerequisite only. When one exists, pass its exact authoritative path and unchanged snapshot. Work may not create, weaken or mark E rows. This is not a waiver of runtime consumer verification.

Work owns recorded waves, worker dispatch under the host's tool rules, unit implementation, verification, per-wave refinement, plan/diff audits, U status and the integrated compliance gate. Do not retain Fix Review's former direct-worker or small-unit-inline execution path. A blocked unit stays visibly blocked; independent authorized units may proceed only under Work's own scheduling rules. Inability to invoke Work is a reported blocker, not permission to invent a substitute execution engine.

## Repair evidence carried into units

These are repair-specific acceptance obligations, not a second execution loop:

- **Before editing:** retain a focused pre-fix reproduction's command, inputs, environment, expected observable and actual failure. Reuse triage proof only when it covers the same baseline and behavior. Missing services, collection errors, new-symbol import failures or incomplete fakes are not behavioral RED. Repair the probe first; failure to reproduce leaves the claim unproven.
- **Changed APIs:** if needed, expose old behavior through a temporary test-only adapter in an isolated copy without changing semantics. Preserve original source, remove the adapter afterwards, and never use a repository-global stash. Migration experiments/data writes require an isolated database. Prose-only fixes use governing-source comparison rather than an invented executable failure.
- **After editing:** rerun the same probe; changed probe assumptions require renewed RED. Exercise the implicated real entrypoint, configuration and data. UI proof follows the failing browser action through the final visible state; build proof uses freshly emitted artifacts; stateful proof inspects affected success/failure/cancel/retry transitions, persisted state and resource ownership. Select transitions from the actual mechanism, not a speculative matrix.
- **Proof boundaries:** forced flags or direct service construction do not prove configured startup. Distinguish mocks, skips, local behavioral proof and live-path verification. A fix preventing recurrence does not prove existing corrupt state recovered. Repairing historical state requires its own selected scope and isolated proof.

## Work return contract

Work must still complete node L after its integrated gate passes: write one durable packet under `.wayne/checkpoints/` via `wayne-checkpoint` return-only mode or Work's supported canonical packet contract, verify the file exists and return its path. Preserve `next_agent: wayne-code-review` as the recommended next stage, not permission to invoke it. Work does not automatically execute code review; returning to Fix Review for final reconciliation neither replaces the checkpoint with a chat receipt nor skips L.

The packet includes the executed plan path, authoritative matrix path or explicit absence, unit results, actual changed paths, exact RED/GREEN and surface evidence, combined-check/compliance receipt, preserved baseline/scope and residual risks. Preserve Work's U ownership and any E status unchanged. If Work is blocked before J passes, return its blocker and existing evidence instead of claiming a completed L packet. Plan's no-checkpoint override above applies to Plan only, not Work.

Fix Review consumes that receipt for remote refresh and final dispositions; it does not implement a missing fix itself. Failed execution proof returns to Work under the same approved unit; a plan gap returns to Plan; changed scope or behavior returns to the human. Do not report local closure with an accepted defect or required proof still unresolved. Commit, publication and downstream review/verify/ship remain separately authorized.
