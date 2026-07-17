# Task

Read `AGENTS.md`, `review-packet.md`, `raw/claude.md`, and `raw/codex.md`.
Synthesize only those two immutable reviewer reports.

Requirements:

1. Report `shell-command-injection` once as a dual-voice-confirmed `CRITICAL`
   finding, with both reviewer attributions and the shared file/line evidence.
2. Preserve `overwrite-default-compatibility` as a disagreement. State Claude's
   `CRITICAL` position and rationale, then Codex's `NOT_A_FINDING` position and
   rationale. Do not choose a winner or label it confirmed.
3. Recompute counts from the raw artifacts. A `NOT_A_FINDING` disposition is not
   a finding and must not inflate the confirmed-finding count.
4. State that the unresolved confirmed `CRITICAL` finding makes the review result
   `FAIL`. Runtime behavior remains unverified.
5. Do not edit or create files, invoke another reviewer, auto-fix anything, run
   the application, write a checkpoint, or invoke a downstream stage.

Return only the user-visible synthesis.
