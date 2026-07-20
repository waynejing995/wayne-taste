# Plan validator-boundary hotfix

The live Plan tree is
`d3ccebc7b847de603e4d74cd3523ae9281c4966f8bc2e3b8c7f0ba71fc3bf872`.

## Corrected ownership

- E IDs are inventoried only inside the one bounded E2E Verification Contract
  section. E-shaped review tables elsewhere are ignored.
- Structured `path::symbol` fields still require repository-relative grammar and a
  readable file. Whether a symbol is genuinely defined/appropriate is contextual
  review, not a last-token grep.
- Exact `TBD`/`TODO` markers remain deterministic. Other wording, code fences, git
  text, and path-looking prose are judged for meaning by execution-readiness review,
  not global keyword/regex scans.

## Calibration

- Bounded E owner: real `E1` passes with an external `E99` decoy; missing owner
  section fails; bounded `E2E: none` passes.
- Surface boundary: readable file passes without pretending to prove a future
  symbol; missing file fails.
- Plan artifact suite: one valid normal, 20 independent invalid mutations, and five
  valid representation/prose variants pass as expected.
- The new exact cases prove a specific “Add validation …” instruction passes while
  a U-surface textual-prefix collision fails.
- Pipeline-ID calibration and Forge static remain PASS (0 errors; one size warning).

No model cell was scored for this deterministic boundary change. The blind rubric
owns the semantic questions that were removed from runtime validation.
