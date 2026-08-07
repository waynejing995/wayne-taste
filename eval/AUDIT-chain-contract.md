# Chain Contract Audit — mind-explode → test-design → plan → work → code-review → verify

Cross-stage handoff audit. Complements `AUDIT-lexical-proxy.md` (within-validator
lexical proxies). This one asks: does each consumer re-parse upstream *meaning*
instead of consuming a structured fact from the one owner, and has `_shared`
drifted.

Research only. Nothing edited.

## Method note

The workflow (`wf_eac523db-497`) stalled: 6 of 17 agents hung on provider timeouts,
synthesize never ran. 4 of 5 handoffs + 7 verdicts were salvaged from its journal.
The missing boundary (**plan→work**) and the **`_shared` drift** check were
completed by hand (direct file reads). All findings below are verified against the
actual source.

## Confirmed cross-stage defects

### 1. `extract_e_contract` scans the whole file — violates the id-contract

- **File:** `wayne-plan/scripts/validate_plan.py:247-273`
- **Boundary:** test-design → plan
- **Severity:** high
- **Contract violated:**
  - `_shared/pipeline-id-contract.md:22` — "Never inventory IDs by scanning a whole
    file for `R\d+`, `D\d+`, or similar tokens."
  - `_shared/pipeline-id-contract.md:41-43` — E`<number>` is defined "only in its
    bounded E2E contract table."
- **What it observes vs claims:** `extract_e_contract` iterates
  `markdown_tables(matrix_text)` over the ENTIRE matrix file (line 250) and treats
  any table whose first column `fullmatch(r"E\d+")` (line 254) as an E-contract
  candidate. It claims to isolate "the one authoritative E contract" but actually
  scans every table anywhere in the file for E-shaped tokens — the exact move the
  contract forbids.
- **The asymmetry (this is the tell):** the sibling `extract_u_seed_rows`
  (line 200-211) does it CORRECTLY — it first locates the bounded `## U-SEED`
  section by heading, slices to the next heading, and only searches for a table
  *inside* that section. `plan-contract.md:76` even spells out the rule for U-SEED:
  "Do not discover seeds from prose or tables outside that section." E-extraction
  has no equivalent bounding, and no equivalent contract clause. **Same file, two
  standards for two ID namespaces.**
- **Concrete failure:** `plan-contract.md:172` requires the plan to copy the
  complete E table byte-for-byte into the plan as a design-time E snapshot. So a
  plan file legitimately contains the source E table AND its snapshot copy — two
  tables with `E\d+` first columns. `extract_e_contract` then sees
  `len(candidates) == 2`, trips `len(none_lines) + len(candidates) != 1` (line 258),
  and emits a false `source-e-contract` error. U-SEED never hits this because its
  section boundary scopes the search; E does.
- **The fix anchor exists:** the E2E table lives under `## Layer 2: E2E
  Verification Contract` in `test-matrix-template.md:62`, exactly parallel to
  `### U-SEED`. `extract_e_contract` can bound to that section the same way
  `extract_u_seed_rows` bounds to `## U-SEED`. Not a design dead-end.
- **Preserve:** the row-level checks (E\d+ id shape, `⬜` status presence, id
  uniqueness at lines 267-272) are legit machine-layer invariants — keep them; only
  the unbounded whole-file table scan is the defect.

### 2. Dual-review payload omits the intent/excerpts the SKILL contract promises

- **File:** `wayne-code-review/scripts/run_dual_review.py:246-288` (build_payload)
- **Boundary:** work → code-review
- **Severity:** medium (salvaged from workflow; verified)
- **What it observes vs claims:** `build_payload()` constructs the sole packet both
  review voices ever see. SKILL.md section A states reviewers receive the "intent
  summary" and "selected source excerpts," but the built payload carries the frozen
  git patch + playbook text only. The two voices are asked to judge intent fidelity
  against an artifact that does not include the intent. Format (a well-formed
  packet) is produced; the semantic input the contract promises is absent.
- **Note:** verify independently against current lines — the workflow verdict cited
  256-288; treat the line number as approximate and confirm before acting.

## Clean boundaries (audited, no defect)

- **plan → work** — `wayne-work/SKILL.md:16` links `pipeline-id-contract.md` and
  states "consume IDs only from their defining structures and never renumber
  upstream artifacts." Lines 148-149 restrict Work to flipping plan-owned U rows
  `☐→☑` and explicitly forbid editing U scenario text, the plan's E snapshot, or
  any authoritative E `⬜`. State ownership is clean; no re-parse, no reverse-edit.
- **`_shared` drift** — the LOCKED 7-column E2E format is defined once in
  `test-matrix-template.md:80`. `wayne-verify` and `wayne-test-design` reference the
  columns (`User path`, `Env: process`, …) but do not redeclare the format table.
  No copy, no drift.

## Cross-workflow disagreement to resolve (validate_plan.py:682, the arrow count)

The two audits disagree on the arrow-count rule and you should be the tiebreaker:

- **`AUDIT-lexical-proxy.md` (workflow 1)** classified `:682`
  `scenario.count("→") != 2` as **SHAPE-POLICING (medium)** — a template-shape proxy
  that rejects concrete 1-arrow (`missing config → ConfigError`) and 4-arrow
  two-branch scenarios.
- **This chain audit (workflow 2 verdict)** classified the same line as
  **MACHINE-LEGIT** — "a legit machine-layer SHAPE gate, not a semantic proxy."

Both cannot be right. My read: it is a shape gate (deterministic, low-freedom) that
is being *sold* as a concreteness check. The finding message claims the row "must
use concrete input → action → expected," which is a semantic claim; the code only
counts arrows. So it is a deterministic check mislabeled as a semantic oracle — the
`AUDIT-lexical-proxy` classification is the more accurate one, but the *fix* is to
correct the claim/message and loosen the count, not to delete the gate. Your call.

## What this audit did NOT do

- Did not re-run the failed workflow to completion (provider stalls, not a script
  bug). Hand-completed the two missing pieces instead.
- Did not touch any audited file.
